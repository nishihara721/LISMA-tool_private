// 日ごとの集計(友だち追加数・成果数)を保存・読み出しするためのロジック。
//
// レポート画面は、期間内の友だち・成果のドキュメントを1件ずつ読み込むと、友だち数に比例して読み取り件数が増える。
// そこで、友だち追加・成果が発生するたびに「その日(日本時間)の集計ドキュメント」へ件数を加算しておき、
// レポートはその集計ドキュメント(1日につき1件)だけを読む。1年分でも読み取りは365件で済む。
//
// Firestore コレクション: daily_stats  (ドキュメントID = YYYY-MM-DD・日本時間)
//   friends:  { [流入経路ID]: 友だち追加数 }                         … 友だち追加時の流入経路(sourceId)ごと
//   cv:       { [sourceId|latestSourceId|purchaseLinkId]: 成果数 }   … 自動計測の成果(非表示にしたものを除く)
//   cvImport: { [広告名]: 成果数 }                                   … CSV等で手動追加した成果(非表示にしたものを除く)
// ここには流入経路ID・広告IDだけを持たせ、名前・ポップアップ名・成果単価などは読み出し時に最新の設定から引く
// (流入経路・広告を編集した場合も、過去分のレポートに反映される)。
//
// コレクション: daily_stats_meta  ドキュメント "state" { coverageFrom: YYYY-MM-DD }
//   coverageFrom 以降の日付は、集計が漏れなく加算されている(集計ドキュメントが無い日 = その日は0件)ことを表す。
//   coverageFrom より前の日付は、従来どおり元のドキュメントを直接読み込む。
//   最初の友だち追加・成果の記録のときに自動で作成する(ensureCoverage)。値は「記録した日の翌日」。
//   (その日の、記録前に起きた分は集計に入っていないため、その日は元のドキュメントを直接読み、翌日以降を集計から読む)
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "./firebase-admin";
import { getDocsByIds } from "./firestore-utils";
import { logEvent } from "./event-log";
import { invalidateReportCache } from "./report-cache";

export type DailyStatsDoc = {
  date: string;
  friends?: Record<string, number>;
  cv?: Record<string, number>;
  cvImport?: Record<string, number>;
};

const COL = "daily_stats";
const META_COL = "daily_stats_meta";
const NONE = "(none)";
const DAY_MS = 24 * 60 * 60 * 1000;

export function statsDateKey(ms: number): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date(ms));
}

const enc = (v: string | undefined | null) => (v ? encodeURIComponent(v).replace(/\./g, "%2E") : NONE);
const dec = (v: string) => (v === NONE ? undefined : decodeURIComponent(v));

export const cvStatsKey = (sourceId?: string, latestSourceId?: string, purchaseLinkId?: string) =>
  [enc(sourceId), enc(latestSourceId), enc(purchaseLinkId)].join("|");
export function parseCvStatsKey(key: string) {
  const [s, l, p] = key.split("|");
  return { sourceId: dec(s), latestSourceId: dec(l), purchaseLinkId: dec(p) };
}
export const importStatsKey = (purchaseLinkName?: string) => enc(purchaseLinkName?.trim());
export const parseImportStatsKey = (key: string) => dec(key);
export const friendStatsKey = (sourceId?: string) => enc(sourceId);
export const parseFriendStatsKey = (key: string) => dec(key);

type Delta = { date: string; field: "friends" | "cv" | "cvImport"; key: string; delta: number };

// 件数の加算(減算)をまとめて書き込む。集計の更新に失敗しても、本来の処理(友だち追加・成果計測)は止めない
// (エラー・システムログに記録するだけにする。集計のずれの直し方は docs/setup.md を参照)。
async function applyDeltas(deltas: Delta[]): Promise<void> {
  if (deltas.length === 0) return;
  try {
    await ensureCoverage();
    const byDate = new Map<string, Record<string, Record<string, FieldValue>>>();
    deltas.forEach((d) => {
      const doc = byDate.get(d.date) ?? {};
      doc[d.field] = { ...(doc[d.field] ?? {}), [d.key]: FieldValue.increment(d.delta) };
      // 同じキーが複数あれば加算し直す
      byDate.set(d.date, doc);
    });
    const batch = adminDb.batch();
    byDate.forEach((fields, date) => {
      batch.set(adminDb.collection(COL).doc(date), { date, ...fields }, { merge: true });
    });
    await batch.commit();
  } catch (e) {
    await logEvent("warn", "daily_stats.update_failed", "日ごとの集計の更新に失敗しました(レポートの件数がずれる可能性があります)", {
      error: String(e),
    });
  }
}

// 同じ日・同じキーのdeltaを1つにまとめてから書き込む(1つのbatchで同じフィールドを複数回incrementしないため)
function mergeDeltas(deltas: Delta[]): Delta[] {
  const map = new Map<string, Delta>();
  deltas.forEach((d) => {
    const k = `${d.date}\t${d.field}\t${d.key}`;
    const cur = map.get(k);
    if (cur) cur.delta += d.delta;
    else map.set(k, { ...d });
  });
  return Array.from(map.values()).filter((d) => d.delta !== 0);
}

const apply = (deltas: Delta[]) => applyDeltas(mergeDeltas(deltas));

export const friendDelta = (addedAt: number, sourceId: string | undefined, delta: number): Delta => ({
  date: statsDateKey(addedAt),
  field: "friends",
  key: friendStatsKey(sourceId),
  delta,
});

export async function recordFriendAdded(addedAt: number, sourceId: string | undefined) {
  await apply([friendDelta(addedAt, sourceId, 1)]);
}

// 複数の友だちの追加をまとめて集計に加算する(LステップのCSVで、導入前の友だちの追加日時が確定したときに使う)
export async function recordFriendsAdded(list: { addedAt: number; sourceId: string | undefined }[]) {
  await apply(list.map((f) => friendDelta(f.addedAt, f.sourceId, 1)));
  invalidateReportCache();
}

// 複数の友だちの追加日時・流入経路の変更をまとめて集計に反映する。
// prev が無い(null)場合は新規の追加として、あれば prev の分を減らして next の分を増やす。
export async function recordFriendsChangedBulk(
  list: { prev: { addedAt: number; sourceId: string | undefined } | null; next: { addedAt: number; sourceId: string | undefined } }[]
) {
  const deltas: Delta[] = [];
  list.forEach(({ prev, next }) => {
    if (prev) deltas.push(friendDelta(prev.addedAt, prev.sourceId, -1));
    deltas.push(friendDelta(next.addedAt, next.sourceId, 1));
  });
  await apply(deltas);
  invalidateReportCache();
}

// 友だちの追加日時・流入経路が変わった場合(ブロック後の再追加、"direct"から実際の流入経路への補完)に、集計を付け替える
export async function recordFriendChanged(
  prev: { addedAt: number; sourceId: string | undefined },
  next: { addedAt: number; sourceId: string | undefined }
) {
  await apply([friendDelta(prev.addedAt, prev.sourceId, -1), friendDelta(next.addedAt, next.sourceId, 1)]);
  invalidateReportCache();
}

export const cvDelta = (
  convertedAt: number,
  c: { sourceId?: string; latestSourceId?: string; purchaseLinkId?: string },
  delta: number
): Delta => ({
  date: statsDateKey(convertedAt),
  field: "cv",
  key: cvStatsKey(c.sourceId, c.latestSourceId, c.purchaseLinkId),
  delta,
});

export const importCvDelta = (convertedAt: number, purchaseLinkName: string | undefined, delta: number): Delta => ({
  date: statsDateKey(convertedAt),
  field: "cvImport",
  key: importStatsKey(purchaseLinkName),
  delta,
});

export const applyStatsDeltas = apply;

// ---- 読み出し ----

let metaCache: { at: number; coverageFrom: string | null } | null = null;

export async function getCoverageFrom(): Promise<string | null> {
  if (metaCache && (metaCache.coverageFrom || Date.now() - metaCache.at < 30_000)) return metaCache.coverageFrom;
  const snap = await adminDb.collection(META_COL).doc("state").get();
  const coverageFrom = (snap.data()?.coverageFrom as string | undefined) ?? null;
  metaCache = { at: Date.now(), coverageFrom };
  return coverageFrom;
}

export async function getDailyStatsMap(dateKeys: string[]): Promise<Map<string, DailyStatsDoc>> {
  return getDocsByIds<DailyStatsDoc>(adminDb.collection(COL), dateKeys);
}

// 最初の友だち追加・成果の記録のとき(daily_stats_meta/state がまだ無いとき)に、自動で「集計あり」の状態にする。
// coverageFrom は記録した日の翌日。それ以前の日付は、これまでどおり元のドキュメントを直接読み込む。
// 一度作成したら、以降は読み取りも書き込みもしない(サーバー内で作成済みを覚えておく)。
async function ensureCoverage(): Promise<void> {
  if (metaCache?.coverageFrom) return;
  const ref = adminDb.collection(META_COL).doc("state");
  const snap = await ref.get();
  if (snap.exists && snap.data()?.coverageFrom) {
    metaCache = { at: Date.now(), coverageFrom: snap.data()!.coverageFrom as string };
    return;
  }
  const coverageFrom = statsDateKey(Date.now() + DAY_MS);
  try {
    await ref.create({ coverageFrom, createdAt: Date.now() });
  } catch {
    // 同時に別の記録が作成した場合(ALREADY_EXISTS)は、そちらの値を使う
    const again = await ref.get();
    metaCache = { at: Date.now(), coverageFrom: (again.data()?.coverageFrom as string | undefined) ?? coverageFrom };
    return;
  }
  metaCache = { at: Date.now(), coverageFrom };
  invalidateReportCache();
}
