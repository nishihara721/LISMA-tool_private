// 友だち一覧・各ログ画面用の、サーバー側ページネーション付きデータ取得。
//
// ・並び順は「日時の新しい順」。ページ送りはカーソル方式(前ページの最後の行の日時+ID)で、
//   「次のページ」を開くたびに続きの分だけを読み込む(OFFSETは読み飛ばした分も課金されるため使わない)。
// ・期間(主たる日時)の絞り込みはFirestoreの範囲指定で行い、期間外のデータは読み込まない。
// ・ユーザー名・流入経路などのその他の絞り込みは、複合インデックスを増やさずに済むよう、
//   一定件数ずつ読み込んでから条件に合う行を拾う方式。条件に合う行が少ない場合でも、
//   1回のリクエストで読み込む件数に上限(SCAN_CAP)を設けてある(上限に達したら続きは「次へ」で読む)。
import { FieldPath, type DocumentData, type Query } from "firebase-admin/firestore";
import { adminDb } from "./firebase-admin";
import { chunk, getDocsByIds } from "./firestore-utils";
import { getAllPurchaseLinks, getAllSources } from "./settings-cache";
import type { ClickDoc, ConversionDoc, EventLogDoc, FriendDoc, PurchaseLinkDoc, SourceDoc } from "@/types";

export type TableKind = "friends" | "purchase_clicks" | "conversions" | "source_link_clicks" | "event_logs" | "cv_log";
export const TABLE_KINDS: TableKind[] = ["friends", "purchase_clicks", "conversions", "source_link_clicks", "event_logs", "cv_log"];

export type FilterValue = { text?: string; values?: string[]; from?: string; to?: string };
export type TableQuery = {
  kind: TableKind;
  cursor?: string | null;
  pageSize: number;
  filters: Record<string, FilterValue>;
  // trueの場合、友だち名(friend)のセルを結果から除き、ユーザー名での絞り込みも無効にする(レポート閲覧権限向け)
  hideFriendName?: boolean;
};
export type TableResult = {
  rows: { id: string; cells: Record<string, string> }[];
  nextCursor: string | null;
  hasMore: boolean;
};

const SCAN_BATCH = 200; // 絞り込みがある場合に、1回のFirestore問い合わせで読み込む件数
const SCAN_CAP = 1000; // 1回のリクエストで読み込む件数の上限

type Item = { id: string; data: DocumentData };
type Built = {
  id: string;
  sortTs: number;
  cells: Record<string, string>;
  values: Record<string, string>; // テキスト・プルダウン絞り込みの対象値
  dates: Record<string, number>; // 日時絞り込みの対象値(ミリ秒)
};
type Ctx = { sourceMap: Map<string, SourceDoc>; purchaseLinkMap: Map<string, PurchaseLinkDoc> };
type Key = { ts: number; id: string };
type Batch = { items: Item[]; exhausted: boolean; last: Key | null };
type Def = {
  collection: string;
  // 指定すると、通常の「1つのコレクションを読む」処理の代わりにこちらで読み込む(複数のコレクションを合わせて並べる画面用)。
  // 並び順は (orderField 降順, ドキュメントID 降順)。cursor の次から最大 n 件(exhausted は「これ以降にデータが無い」)。
  fetchBatch?: (cursor: Key | null, fromMs: number | undefined, toMs: number | undefined, n: number) => Promise<Batch>;
  orderField: string;
  primaryDateKey: string; // orderFieldに対応する絞り込みキー(Firestore側の範囲指定に使う)
  prefilter?: (data: DocumentData) => boolean;
  build: (items: Item[], ctx: Ctx) => Promise<Built[]>;
  finalize?: (rows: Built[]) => Promise<void>; // 表示する行が確定した後にだけ行う追加の読み込み
};

// 日時はサーバーの時刻設定(VercelはUTC)に左右されないよう、常に日本時間で表示・判定する。
const fmt = (ms: number) => new Date(ms).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
const jstStart = (d: string) => Date.parse(`${d}T00:00:00+09:00`);
const jstEnd = (d: string) => Date.parse(`${d}T23:59:59.999+09:00`);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function sourceNameOf(sourceId: string | undefined, sourceMap: Map<string, SourceDoc>): string {
  if (!sourceId) return "(未特定)";
  if (sourceId === "direct") return "直接追加";
  return sourceMap.get(sourceId)?.name ?? sourceId;
}

function idNumberOf(userId: string | undefined, friendMap: Map<string, FriendDoc>) {
  const n = userId ? friendMap.get(userId)?.idNumber : undefined;
  return n ? String(n) : "-";
}

function displayNameOf(userId: string | undefined, friendMap: Map<string, FriendDoc>) {
  if (!userId) return "(未特定)";
  return friendMap.get(userId)?.displayName ?? userId;
}

const friendIdsOf = (items: Item[]) => items.map((i) => i.data.userId as string | undefined).filter((v): v is string => !!v);

// ---- 友だち一覧 ----
const friends: Def = {
  collection: "friends",
  orderField: "addedAt",
  primaryDateKey: "addedAt",
  async build(items, ctx) {
    return items.map(({ id, data }) => {
      const f = data as FriendDoc;
      const displayName = f.displayName ?? f.userId;
      const source = sourceNameOf(f.sourceId, ctx.sourceMap);
      const status = f.unfollowedAt ? "ブロック/解除済" : "友だち";
      return {
        id,
        sortTs: f.addedAt,
        cells: {
          idNumber: f.idNumber ? String(f.idNumber) : "-",
          displayName,
          lineUserId: f.userId,
          lstepNumber: f.lstepNumber ?? "-",
          source,
          addedAt: fmt(f.addedAt),
          preExisting: f.preExisting ? (f.addedAtEstimated ? "導入前(日時未確定)" : "導入前") : "-",
          // 以下は画面には出さず、手動変更ダイアログ用の元の値(列の定義に無いキーは表示・CSVに出ない)
          sourceId: f.sourceId ?? "",
          addedAtMs: String(f.addedAt),
          isPreExisting: f.preExisting ? "1" : "",
          isEstimated: f.addedAtEstimated ? "1" : "",
          cvCount: "0",
          status,
        },
        values: { userName: displayName, lineUserId: f.userId, source, status, lstep: f.lstepNumber ? "付与済み" : "未付与", preExisting: f.preExisting ? "導入前" : "通常" },
        dates: { addedAt: f.addedAt },
      };
    });
  },
  // 購入回数は、画面に出す行(最大でページ分)のuserIdだけを対象に集計する。
  // where("in")は一度に渡せる値の数に上限があるため、10件ずつ問い合わせる。
  async finalize(rows) {
    const ids = Array.from(new Set(rows.map((r) => r.cells.lineUserId).filter(Boolean)));
    if (ids.length === 0) return;
    const counts: Record<string, number> = {};
    const snaps = await Promise.all(
      chunk(ids, 10).map((c) => adminDb.collection("conversions").where("userId", "in", c).get())
    );
    snaps.forEach((snap) =>
      snap.docs.forEach((d) => {
        const uid = (d.data() as ConversionDoc).userId;
        if (uid) counts[uid] = (counts[uid] ?? 0) + 1; // 未特定の成果は購入回数に含めない
      })
    );
    rows.forEach((r) => (r.cells.cvCount = String(counts[r.cells.lineUserId] ?? 0)));
  },
};

// ---- 広告クリックログ ----
// 友だち追加時・最新の流入経路は、クリック時点のスナップショットがあればそれを優先し、
// スナップショットが記録される前の古いクリックのみ友だちの現在値にフォールバックする。
function friendSourcesOf(click: ClickDoc, friendMap: Map<string, FriendDoc>, sourceMap: Map<string, SourceDoc>) {
  if (click.friendSourceIdAtClick !== undefined || click.friendLatestSourceIdAtClick !== undefined) {
    return {
      original: sourceNameOf(click.friendSourceIdAtClick, sourceMap),
      latest: sourceNameOf(click.friendLatestSourceIdAtClick ?? click.friendSourceIdAtClick, sourceMap),
    };
  }
  const friend = click.userId ? friendMap.get(click.userId) : undefined;
  if (!friend) return { original: "(未特定)", latest: "(未特定)" };
  return {
    original: sourceNameOf(friend.sourceId, sourceMap),
    latest: sourceNameOf(friend.latestSourceId ?? friend.sourceId, sourceMap),
  };
}

const purchaseClicks: Def = {
  collection: "clicks",
  orderField: "clickedAt",
  primaryDateKey: "clickedAt",
  // linkTypeの絞り込みはFirestore側のwhereではなく、読み込んだ後にこちらで行う(複合インデックスを増やさないため)
  prefilter: (d) => d.linkType === "purchase",
  async build(items, ctx) {
    const friendMap = await getDocsByIds<FriendDoc>(adminDb.collection("friends"), friendIdsOf(items));
    return items.map(({ id, data }) => {
      const c = data as ClickDoc;
      const friend = displayNameOf(c.userId, friendMap);
      const { original, latest } = friendSourcesOf(c, friendMap, ctx.sourceMap);
      const purchaseLink = ctx.purchaseLinkMap.get(c.purchaseLinkId ?? "")?.name ?? c.purchaseLinkId ?? "(不明)";
      return {
        id,
        sortTs: c.clickedAt,
        cells: { clickedAt: fmt(c.clickedAt), purchaseLink, idNumber: idNumberOf(c.userId, friendMap), friend, original, latest, clickId: c.clickId },
        values: { userName: friend, originalSource: original, latestSource: latest, purchaseLink },
        dates: { clickedAt: c.clickedAt },
      };
    });
  },
};

// ---- 広告成果ログ ----
const conversions: Def = {
  collection: "conversions",
  orderField: "convertedAt",
  primaryDateKey: "convertedAt",
  async build(items, ctx) {
    const convs = items.map((i) => i.data as ConversionDoc);
    const [clickMap, friendMap] = await Promise.all([
      getDocsByIds<ClickDoc>(adminDb.collection("clicks"), convs.map((c) => c.clickId).filter(Boolean)),
      getDocsByIds<FriendDoc>(adminDb.collection("friends"), friendIdsOf(items)),
    ]);
    return items.map(({ id }, i) => {
      const c = convs[i];
      const originClick = clickMap.get(c.clickId);
      const friend = displayNameOf(c.userId, friendMap);
      const original = sourceNameOf(c.sourceId, ctx.sourceMap);
      const latest = sourceNameOf(c.latestSourceId ?? c.sourceId, ctx.sourceMap);
      const purchaseLink = ctx.purchaseLinkMap.get(c.purchaseLinkId)?.name ?? c.purchaseLinkId;
      return {
        id,
        sortTs: c.convertedAt,
        cells: {
          clickedAt: originClick ? fmt(originClick.clickedAt) : "-",
          convertedAt: fmt(c.convertedAt),
          purchaseLink,
          idNumber: idNumberOf(c.userId, friendMap),
          friend,
          original,
          latest,
          clickId: c.clickId,
        },
        values: { userName: friend, originalSource: original, latestSource: latest, purchaseLink },
        dates: {
          // クリック記録が見当たらない場合も日時絞り込みから外れないよう、成果日時で代用する
          clickedAt: originClick?.clickedAt ?? c.convertedAt,
          convertedAt: c.convertedAt,
        },
      };
    });
  },
};

// ---- 流入経路ログ ----
const STATUS_LABELS = {
  unidentified: "未特定",
  not_added: "未追加",
  existing: "既存の友だち(再クリック)",
  unblocked: "ブロック解除",
  registered: "既存の友だち(自動登録)",
} as const;

const sourceLinkClicks: Def = {
  collection: "clicks",
  orderField: "clickedAt",
  primaryDateKey: "clickedAt",
  prefilter: (d) => d.linkType === "add_friend",
  async build(items, ctx) {
    const friendMap = await getDocsByIds<FriendDoc>(adminDb.collection("friends"), friendIdsOf(items));
    return items.map(({ id, data }) => {
      const c = data as ClickDoc;
      const friend = displayNameOf(c.userId, friendMap);
      // クリック時点の記録をそのまま表示する。記録が無い古いクリックは現在値で上書きせず「(記録なし)」とする。
      const original =
        c.friendSourceIdAtClick !== undefined
          ? sourceNameOf(c.friendSourceIdAtClick, ctx.sourceMap)
          : c.userId
            ? "(記録なし)"
            : "(未特定)";
      const clicked = c.sourceNameAtClick ?? ctx.sourceMap.get(c.sourceId)?.name ?? c.sourceId;
      const status = c.statusAtClick ? STATUS_LABELS[c.statusAtClick] : "(記録なし)";
      return {
        id,
        sortTs: c.clickedAt,
        cells: { clickedAt: fmt(c.clickedAt), clicked, original, idNumber: idNumberOf(c.userId, friendMap), friend, status, clickId: c.clickId },
        values: { userName: friend, clickedSource: clicked, originalSource: original },
        dates: { clickedAt: c.clickedAt },
      };
    });
  },
};

// ---- エラー・システムログ ----
const LEVEL_LABEL: Record<string, string> = { info: "情報", warn: "警告", error: "エラー" };

const eventLogs: Def = {
  collection: "event_logs",
  orderField: "createdAt",
  primaryDateKey: "createdAt",
  async build(items) {
    return items.map(({ id, data }) => {
      const log = data as EventLogDoc;
      const level = LEVEL_LABEL[log.level] ?? log.level;
      const context = log.context ? JSON.stringify(log.context) : "";
      return {
        id,
        sortTs: log.createdAt,
        cells: { createdAt: fmt(log.createdAt), level, stage: log.stage, message: log.message, context },
        values: {
          level,
          stage: log.stage,
          // 内容と詳細(context)をまとめて部分一致検索できるようにする
          message: context ? `${log.message} ${context}` : log.message,
        },
        dates: { createdAt: log.createdAt },
      };
    });
  },
};

// ---- 編集用成果ログ ----
// 自動計測の成果(conversions)と、手動追加した成果(report_cv_entries の kind="import")を、成果日時の新しい順に1本の一覧にする。
// 非表示の成果も含めて表示する(状態の列で見分ける)。非表示などの上書き情報は report_cv_entries にあり、成果のIDと同じIDで探す。
const keyCmp = (a: Key, b: Key) => (a.ts !== b.ts ? b.ts - a.ts : a.id < b.id ? 1 : a.id > b.id ? -1 : 0); // 降順(新しい順)で前にくる方が負

async function fetchCvLogBatch(cursor: Key | null, fromMs: number | undefined, toMs: number | undefined, n: number): Promise<Batch> {
  const make = (col: string) => {
    let query: Query = adminDb.collection(col);
    if (fromMs !== undefined) query = query.where("convertedAt", ">=", fromMs);
    if (toMs !== undefined) query = query.where("convertedAt", "<=", toMs);
    query = query.orderBy("convertedAt", "desc").orderBy(FieldPath.documentId(), "desc");
    if (cursor) query = query.startAfter(cursor.ts, cursor.id);
    return query.limit(n).get();
  };
  const [convSnap, ovSnap] = await Promise.all([make("conversions"), make("report_cv_entries")]);
  const keyOf = (d: { id: string; get(f: string): unknown }): Key => ({ ts: d.get("convertedAt") as number, id: d.id });
  const convFull = convSnap.docs.length >= n;
  const ovFull = ovSnap.docs.length >= n;
  // 片方のコレクションがまだ続いている場合、そこから先の行は、もう片方に挟まるはずの行を取りこぼす恐れがあるため、
  // 「読み込みが途切れた側の最後の行」までを今回の結果とする
  const bounds: Key[] = [];
  if (convFull) bounds.push(keyOf(convSnap.docs[convSnap.docs.length - 1]));
  if (ovFull) bounds.push(keyOf(ovSnap.docs[ovSnap.docs.length - 1]));
  const bound = bounds.length > 0 ? bounds.sort(keyCmp)[bounds.length - 1] : null; // 最も古い(後ろの)境界

  const merged: (Item & { key: Key })[] = [];
  convSnap.docs.forEach((d) => merged.push({ id: d.id, data: { ...d.data(), _src: "conversion" }, key: keyOf(d) }));
  ovSnap.docs.forEach((d) => {
    // 上書き情報のうち、手動追加の成果だけが一覧の行になる(自動計測の成果の非表示マークは、conversions側の行に反映する)
    if (d.get("kind") === "import") merged.push({ id: d.id, data: { ...d.data(), _src: "import" }, key: keyOf(d) });
  });
  merged.sort((a, b) => keyCmp(a.key, b.key));
  const safe = bound ? merged.filter((m) => keyCmp(m.key, bound) <= 0) : merged;
  // 境界の行そのもの(上書きマーク等で行にならないことがある)も「ここまで読んだ」位置として使う
  return { items: safe.map(({ id, data }) => ({ id, data })), exhausted: !convFull && !ovFull, last: bound ?? (safe.length ? safe[safe.length - 1].key : null) };
}

const cvLog: Def = {
  collection: "conversions",
  orderField: "convertedAt",
  primaryDateKey: "convertedAt",
  fetchBatch: fetchCvLogBatch,
  async build(items, ctx) {
    const autoItems = items.filter((i) => i.data._src === "conversion");
    const [friendMap, overrideMap] = await Promise.all([
      getDocsByIds<FriendDoc>(adminDb.collection("friends"), friendIdsOf(autoItems)),
      getDocsByIds<{ hidden?: boolean }>(adminDb.collection("report_cv_entries"), autoItems.map((i) => i.id)),
    ]);
    return items.map(({ id, data }) => {
      const isImport = data._src === "import";
      const convertedAt = data.convertedAt as number;
      const hidden = isImport ? data.hidden === true : overrideMap.get(id)?.hidden === true;
      let friend = "-";
      let source = "-";
      let purchaseLink = "-";
      let idNumber = "-";
      if (isImport) {
        source = (data.sourceName as string | undefined) || "-";
        purchaseLink = (data.purchaseLinkName as string | undefined) || "-";
      } else {
        const c = data as ConversionDoc;
        friend = c.userId ? displayNameOf(c.userId, friendMap) : "-";
        idNumber = idNumberOf(c.userId, friendMap);
        source = c.sourceId ? sourceNameOf(c.sourceId, ctx.sourceMap) : "-";
        purchaseLink = ctx.purchaseLinkMap.get(c.purchaseLinkId)?.name ?? c.purchaseLinkId ?? "-";
      }
      const kind = isImport ? "インポート" : "自動計測";
      const status = hidden ? "非表示" : "表示中";
      const note = (data.note as string | undefined) ?? "";
      return {
        id,
        sortTs: convertedAt,
        cells: {
          convertedAt: fmt(convertedAt),
          idNumber,
          friend,
          source,
          purchaseLink,
          note,
          kind,
          status,
          rowId: id,
          isHidden: hidden ? "1" : "", // 画面での行の薄い表示用(列の定義に無いキーは表示・CSVに出ない)
        },
        values: { userName: friend, source, purchaseLink, kind, status },
        dates: { convertedAt },
      };
    });
  },
};

const DEFS: Record<TableKind, Def> = {
  friends,
  purchase_clicks: purchaseClicks,
  conversions,
  source_link_clicks: sourceLinkClicks,
  event_logs: eventLogs,
  cv_log: cvLog,
};

function hasContent(f: FilterValue | undefined): f is FilterValue {
  return !!f && (!!f.text || !!f.values?.length || !!f.from || !!f.to);
}

function matches(row: Built, filters: [string, FilterValue][]): boolean {
  for (const [key, f] of filters) {
    if (f.text && !(row.values[key] ?? "").toLowerCase().includes(f.text.toLowerCase())) return false;
    if (f.values?.length && !f.values.includes(row.values[key])) return false;
    if (f.from || f.to) {
      const t = row.dates[key];
      if (t === undefined) return false;
      if (f.from && DATE_RE.test(f.from) && t < jstStart(f.from)) return false;
      if (f.to && DATE_RE.test(f.to) && t > jstEnd(f.to)) return false;
    }
  }
  return true;
}

const cursorOf = (ts: number, id: string) => `${ts}:${id}`;
function parseCursor(c: string | null | undefined): { ts: number; id: string } | null {
  if (!c) return null;
  const i = c.indexOf(":");
  const ts = Number(c.slice(0, i));
  if (i <= 0 || !Number.isFinite(ts)) return null;
  return { ts, id: c.slice(i + 1) };
}

export async function queryTable(q: TableQuery): Promise<TableResult> {
  const def = DEFS[q.kind];
  const [sources, purchaseLinks] = await Promise.all([getAllSources(), getAllPurchaseLinks()]);
  const ctx: Ctx = {
    sourceMap: new Map(sources.map((s) => [s.sourceId, s])),
    purchaseLinkMap: new Map(purchaseLinks.map((p) => [p.purchaseLinkId, p])),
  };

  const primary = q.filters[def.primaryDateKey];
  const fromMs = primary?.from && DATE_RE.test(primary.from) ? jstStart(primary.from) : undefined;
  const toMs = primary?.to && DATE_RE.test(primary.to) ? jstEnd(primary.to) : undefined;
  const postFilters = Object.entries(q.filters).filter(
    ([k, f]) => k !== def.primaryDateKey && hasContent(f) && !(q.hideFriendName && k === "userName")
  );

  // 追加の絞り込みが無ければ「ページ分+1件」だけ読み込めば十分(+1件は次ページの有無の判定用)
  const needsScan = !!def.prefilter || postFilters.length > 0;
  const batchSize = needsScan ? SCAN_BATCH : q.pageSize + 1;

  let cursor: Key | null = parseCursor(q.cursor);
  const out: Built[] = [];
  let scanned = 0;
  let nextCursor: string | null = null;
  let hasMore = false;

  for (;;) {
    let batch: Batch;
    if (def.fetchBatch) {
      batch = await def.fetchBatch(cursor, fromMs, toMs, batchSize);
    } else {
      let query: Query = adminDb.collection(def.collection);
      if (fromMs !== undefined) query = query.where(def.orderField, ">=", fromMs);
      if (toMs !== undefined) query = query.where(def.orderField, "<=", toMs);
      query = query.orderBy(def.orderField, "desc").orderBy(FieldPath.documentId(), "desc");
      if (cursor) query = query.startAfter(cursor.ts, cursor.id);
      const snap = await query.limit(batchSize).get();
      const docs: Item[] = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
      const lastDoc = docs[docs.length - 1];
      batch = {
        items: docs,
        exhausted: docs.length < batchSize,
        last: lastDoc ? { ts: lastDoc.data[def.orderField] as number, id: lastDoc.id } : null,
      };
    }
    const items = batch.items;
    scanned += Math.max(items.length, 1);

    const candidates = def.prefilter ? items.filter((i) => def.prefilter!(i.data)) : items;
    const built = (await def.build(candidates, ctx)).filter((r) => matches(r, postFilters));

    const room = q.pageSize - out.length;
    if (built.length > room) {
      const taken = built.slice(0, room);
      out.push(...taken);
      const last = taken[taken.length - 1];
      nextCursor = last ? cursorOf(last.sortTs, last.id) : null;
      hasMore = true;
      break;
    }
    out.push(...built);

    if (batch.exhausted || !batch.last) {
      nextCursor = null;
      hasMore = false;
      break;
    }
    cursor = batch.last;
    nextCursor = cursorOf(cursor.ts, cursor.id);
    if (out.length >= q.pageSize || scanned >= SCAN_CAP) {
      hasMore = true;
      break;
    }
  }

  await def.finalize?.(out);
  const rows = out.map((r) => {
    if (!q.hideFriendName) return { id: r.id, cells: r.cells };
    const { friend: _friend, ...cells } = r.cells;
    return { id: r.id, cells };
  });
  return { rows, nextCursor, hasMore };
}
