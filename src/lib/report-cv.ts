import { getAllPurchaseLinks, getAllSources } from "./settings-cache";
import { adminDb } from "@/lib/firebase-admin";
import { getDocsByIds } from "@/lib/firestore-utils";
import {
  getCoverageFrom,
  getDailyStatsMap,
  parseCvStatsKey,
  parseFriendStatsKey,
  parseImportStatsKey,
} from "./daily-stats";
import type {
  ConversionDoc,
  DailyAdMetricsDoc,
  DailyAppealAdMetricsDoc,
  DailyExitPointAdMetricsDoc,
  DailyPopupAdMetricsDoc,
  DailyPopupScenarioAdMetricsDoc,
  DailySourceAdMetricsDoc,
  DailyScenarioAdMetricsDoc,
  FriendDoc,
  PurchaseLinkDoc,
  ReportCvEntryDoc,
  SourceDoc,
} from "@/types";

// 日次レポート・編集用成果ログ画面で共通して使う「実効成果リスト」の組み立てロジック。
//
// conversions コレクション(自動計測された成果)自体は書き換えず、report_cv_entries コレクションの
// 上書き情報(手動追加 or 非表示マーク)を突き合わせて、最終的に集計・表示に使う一覧を作る。
function normalizeSourceKey(name: string): string {
  return name.normalize("NFKC").trim();
}

export type EffectiveCvEntry = {
  id: string;
  kind: "auto" | "import";
  hidden: boolean;
  convertedAt: number;
  // sourceId・latestSourceId: 自動計測は記録された値。インポートは、流入経路名が登録済みの流入経路と一致したときだけ入る
  sourceId?: string;
  latestSourceId?: string;
  // kind: "auto" (conversionsに実体があるもの)のみ
  userId?: string;
  purchaseLinkId?: string;
  clickId?: string;
  // 請求額の計算に使う、この成果の広告の成果単価(円)。広告の成果単価が未設定・広告が特定できない場合は0
  billingAmount: number;
  // kind: "import" (CSV等で手動追加したもの)のみ
  note?: string;
  sourceName?: string;
  purchaseLinkName?: string;
};

// 日付の範囲(ミリ秒)を指定して、その範囲内の実効成果一覧を返す。
// (Firestoreの読み取り件数を無制限に増やさないよう、必ず日付範囲で絞り込んで問い合わせる)
export async function getEffectiveCvEntries(fromMs: number, toMs: number): Promise<EffectiveCvEntry[]> {
  const [conversionsSnap, overridesSnap, purchaseLinks, sources] = await Promise.all([
    adminDb
      .collection("conversions")
      .where("convertedAt", ">=", fromMs)
      .where("convertedAt", "<=", toMs)
      .orderBy("convertedAt", "desc")
      .get(),
    adminDb
      .collection("report_cv_entries")
      .where("convertedAt", ">=", fromMs)
      .where("convertedAt", "<=", toMs)
      .orderBy("convertedAt", "desc")
      .get(),
    getAllPurchaseLinks(),
    getAllSources(),
  ]);

  // 手動追加(インポート)した成果は流入経路名しか持たないため、登録済みの流入経路名と突き合わせて
  // sourceIdを割り出す。ポップアップ別・シナリオ別などの集計で、自動計測の成果と同じように振り分けるため。
  // (全角半角・前後の空白の違いは無視する。一致する流入経路がない場合は未設定として扱う)
  const sourceIdByName = new Map<string, string>();
  sources.forEach((src) => sourceIdByName.set(normalizeSourceKey(src.name), src.sourceId));

  // 広告ごとの成果単価(請求額の計算用)。自動計測の成果はpurchaseLinkId、CSV等で手動追加した成果は広告名の完全一致で突き合わせる。
  const unitPriceById = new Map<string, number>();
  const unitPriceByName = new Map<string, number>();
  purchaseLinks.forEach((l) => {
    if (typeof l.unitPrice === "number") {
      unitPriceById.set(l.purchaseLinkId, l.unitPrice);
      unitPriceByName.set(l.name, l.unitPrice);
    }
  });

  const overrides = overridesSnap.docs.map((d) => d.data() as ReportCvEntryDoc);
  const overrideMap = new Map(overrides.map((o) => [o.id, o]));

  const entries: EffectiveCvEntry[] = [];

  conversionsSnap.docs.forEach((d) => {
    const c = d.data() as ConversionDoc;
    const override = overrideMap.get(c.conversionId);
    entries.push({
      id: c.conversionId,
      kind: "auto",
      hidden: override?.hidden ?? false,
      convertedAt: c.convertedAt,
      userId: c.userId,
      sourceId: c.sourceId,
      latestSourceId: c.latestSourceId,
      purchaseLinkId: c.purchaseLinkId,
      clickId: c.clickId,
      billingAmount: unitPriceById.get(c.purchaseLinkId) ?? 0,
    });
  });

  // kind: "import" のものは、conversionsに実体がなくreport_cv_entries自体が成果の実体になる
  overrides
    .filter((o) => o.kind === "import")
    .forEach((o) => {
      const matchedSourceId = o.sourceName ? sourceIdByName.get(normalizeSourceKey(o.sourceName)) : undefined;
      entries.push({
        id: o.id,
        kind: "import",
        hidden: o.hidden,
        convertedAt: o.convertedAt,
        sourceId: matchedSourceId,
        latestSourceId: matchedSourceId,
        note: o.note,
        sourceName: o.sourceName,
        purchaseLinkName: o.purchaseLinkName,
        billingAmount: o.purchaseLinkName ? unitPriceByName.get(o.purchaseLinkName.trim()) ?? 0 : 0,
      });
    });

  entries.sort((a, b) => b.convertedAt - a.convertedAt);
  return entries;
}

// 日付範囲を指定して友だち追加を取得する(日次レポート用。addedAtの範囲で絞り込むため件数は増えすぎない)
export async function getFriendsInRange(fromMs: number, toMs: number): Promise<FriendDoc[]> {
  const snap = await adminDb
    .collection("friends")
    .where("addedAt", ">=", fromMs)
    .where("addedAt", "<=", toMs)
    .orderBy("addedAt", "desc")
    .get();
  // 追加日時が仮(導入前からの友だちを自動登録したもの)の友だちは、日時が確定するまでレポートに含めない
  return snap.docs.map((d) => d.data() as FriendDoc).filter((f) => !f.addedAtEstimated);
}

// ---- レポート用の友だち・成果の取得(日ごとの集計 daily_stats を使う) ----
//
// レポートは「日付×流入経路」などの件数しか使わないため、期間内の友だち・成果のドキュメントを1件ずつ読み込まず、
// 日ごとの集計ドキュメント(src/lib/daily-stats.ts。1日につき1件)から、集計用の最小限のデータを復元して返す。
// 返す FriendDoc / EffectiveCvEntry は、その日(日本時間)の正午の日時を持つ、件数分のデータ。
// 集計が始まる前の日付(daily_stats_meta/state の coverageFrom より前。まだ友だち追加・成果が記録されていない場合も含む)は、
// 従来どおり元のドキュメントを直接読み込む。

const noonOf = (dateKey: string) => Date.parse(`${dateKey}T12:00:00+09:00`);

// 集計から読み出せる範囲(日付キー)と、元のドキュメントを直接読む範囲(ミリ秒)に分ける
async function splitByCoverage(fromMs: number, toMs: number) {
  const coverageFrom = await getCoverageFrom();
  const fromKey = dateKeyJST(fromMs);
  const toKey = dateKeyJST(toMs);
  if (!coverageFrom || coverageFrom > toKey) {
    return { statsKeys: [] as string[], rawFromMs: fromMs, rawToMs: toMs, hasRaw: true };
  }
  const statsFrom = coverageFrom > fromKey ? coverageFrom : fromKey;
  const statsKeys = enumerateDateKeys(statsFrom, toKey);
  const coverageStartMs = Date.parse(`${coverageFrom}T00:00:00+09:00`);
  return { statsKeys, rawFromMs: fromMs, rawToMs: coverageStartMs - 1, hasRaw: fromMs < coverageStartMs };
}

export async function getReportFriends(fromMs: number, toMs: number): Promise<FriendDoc[]> {
  const { statsKeys, rawFromMs, rawToMs, hasRaw } = await splitByCoverage(fromMs, toMs);
  const [raw, statsMap] = await Promise.all([
    hasRaw ? getFriendsInRange(rawFromMs, rawToMs) : Promise.resolve([] as FriendDoc[]),
    statsKeys.length > 0 ? getDailyStatsMap(statsKeys) : Promise.resolve(new Map()),
  ]);
  const friends: FriendDoc[] = [...raw];
  statsKeys.forEach((key) => {
    const stats = statsMap.get(key);
    Object.entries(stats?.friends ?? {}).forEach(([k, n]) => {
      const sourceId = parseFriendStatsKey(k);
      for (let i = 0; i < (n as number); i++) {
        friends.push({ userId: "", sourceId, addedAt: noonOf(key) } as FriendDoc);
      }
    });
  });
  return friends;
}

// 非表示のものは集計に入っていないため、返す成果はすべて「表示中」(hidden: false)。
export async function getReportCvEntries(fromMs: number, toMs: number): Promise<EffectiveCvEntry[]> {
  const { statsKeys, rawFromMs, rawToMs, hasRaw } = await splitByCoverage(fromMs, toMs);
  const [raw, statsMap, purchaseLinks] = await Promise.all([
    hasRaw ? getEffectiveCvEntries(rawFromMs, rawToMs) : Promise.resolve([] as EffectiveCvEntry[]),
    statsKeys.length > 0 ? getDailyStatsMap(statsKeys) : Promise.resolve(new Map()),
    statsKeys.length > 0 ? getAllPurchaseLinks() : Promise.resolve([] as PurchaseLinkDoc[]),
  ]);
  const unitPriceById = new Map<string, number>();
  const unitPriceByName = new Map<string, number>();
  purchaseLinks.forEach((l) => {
    if (typeof l.unitPrice === "number") {
      unitPriceById.set(l.purchaseLinkId, l.unitPrice);
      unitPriceByName.set(l.name, l.unitPrice);
    }
  });

  const entries: EffectiveCvEntry[] = [...raw];
  statsKeys.forEach((key) => {
    const stats = statsMap.get(key);
    Object.entries(stats?.cv ?? {}).forEach(([k, n]) => {
      const { sourceId, latestSourceId, purchaseLinkId } = parseCvStatsKey(k);
      for (let i = 0; i < (n as number); i++) {
        entries.push({
          id: `stats:${key}:${k}:${i}`,
          kind: "auto",
          hidden: false,
          convertedAt: noonOf(key),
          sourceId,
          latestSourceId,
          purchaseLinkId,
          billingAmount: purchaseLinkId ? unitPriceById.get(purchaseLinkId) ?? 0 : 0,
        });
      }
    });
    Object.entries(stats?.cvImport ?? {}).forEach(([k, n]) => {
      const purchaseLinkName = parseImportStatsKey(k);
      for (let i = 0; i < (n as number); i++) {
        entries.push({
          id: `stats:${key}:import:${k}:${i}`,
          kind: "import",
          hidden: false,
          convertedAt: noonOf(key),
          purchaseLinkName,
          billingAmount: purchaseLinkName ? unitPriceByName.get(purchaseLinkName.trim()) ?? 0 : 0,
        });
      }
    });
  });
  entries.sort((a, b) => b.convertedAt - a.convertedAt);
  return entries;
}

// ミリ秒 → 日本時間での日付キー(YYYY-MM-DD)に変換する。
// サーバーの実行タイムゾーンに関わらず、常に日本時間の日付で集計を揃えるために使う。
export function dateKeyJST(ms: number): string {
  // "sv-SE"ロケールはYYYY-MM-DD形式で日付を返すため、これを利用している
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date(ms));
}

// 「現在稼働中」のポップアップ・シナリオ等を自動判定する際に見る直近の日数
// (この日数分の友だち追加・成果・ad_metrics取り込みに登場するかどうかで判定する)。
export const ACTIVE_WINDOW_DAYS = 7;

// 直近N日間(今日を含む、日本時間)の日付範囲を返す。「現在稼働中」判定専用(表示期間の指定とは独立)。
export function recentDateKeyRange(days: number): { fromDateKey: string; toDateKey: string } {
  const toDateKey = dateKeyJST(Date.now());
  const d = new Date();
  d.setDate(d.getDate() - (days - 1));
  const fromDateKey = dateKeyJST(d.getTime());
  return { fromDateKey, toDateKey };
}

// 日付範囲(YYYY-MM-DD, 日本時間, 両端含む)に含まれるすべての日付キーを列挙する
export function enumerateDateKeys(fromDateKey: string, toDateKey: string): string[] {
  const keys: string[] = [];
  const cursor = new Date(`${fromDateKey}T00:00:00+09:00`);
  const end = new Date(`${toDateKey}T00:00:00+09:00`);
  while (cursor.getTime() <= end.getTime()) {
    keys.push(dateKeyJST(cursor.getTime()));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}

// 指定した日付キー(YYYY-MM-DD)一覧に対応する広告・ポップアップ指標(PV数・imp数・CL数)をまとめて取得する。
// ドキュメントIDが日付キーそのものなので、getDocsByIdsで必要な日数分だけを問い合わせる(範囲が伸びても読み取り件数は日数分で頭打ちになる)。
export async function getAdMetricsByDates(dateKeys: string[]): Promise<Map<string, DailyAdMetricsDoc>> {
  return getDocsByIds<DailyAdMetricsDoc>(adminDb.collection("daily_ad_metrics"), dateKeys);
}

export type DailyReportRow = {
  date: string; // YYYY-MM-DD (日本時間)
  pvCount: number | null; // 未インポートの日はnull
  impCount: number | null; // 未インポートの日はnull
  impRate: number | null; // パーセント(imp数 ÷ PV数)。imp数・PV数のいずれかが未インポート、もしくはPV数が0の日はnull
  clCount: number | null; // 未インポートの日はnull
  clRate: number | null; // パーセント(CL数 ÷ imp数)。CL数・imp数のいずれかが未インポート、もしくはimp数が0の日はnull
  friendCount: number;
  friendAddRate: number | null; // パーセント(友だち追加数 ÷ CL数)。CL数が未インポート、もしくは0の日はnull
  cvCount: number;
  cvr: number | null; // パーセント(成果数 ÷ 友だち追加数)。友だち追加数が0の日はnull
  billingAmount: number; // 請求額(円)= 成果(非表示を除く)ごとの、その広告の成果単価の合計
  memo: string; // 日次レポート画面の「メモ」欄(未入力は空文字)
};

// 指定した日付範囲(日本時間, YYYY-MM-DD)のすべての日について、
// PV数・imp数・imp率・CL数・CL率・友だち追加数・友だち追加率・成果数(非表示を除く)・成果率を集計する。
// 該当データが1件もない日も0件の行として含める(欠けている日がないようにするため)。
export function buildDailyReport(
  fromDateKey: string,
  toDateKey: string,
  friends: FriendDoc[],
  cvEntries: EffectiveCvEntry[],
  adMetricsByDate: Map<string, DailyAdMetricsDoc> = new Map()
): DailyReportRow[] {
  const friendCountByDate = new Map<string, number>();
  friends.forEach((f) => {
    const key = dateKeyJST(f.addedAt);
    friendCountByDate.set(key, (friendCountByDate.get(key) ?? 0) + 1);
  });

  const cvCountByDate = new Map<string, number>();
  const billingByDate = new Map<string, number>();
  cvEntries
    .filter((c) => !c.hidden)
    .forEach((c) => {
      const key = dateKeyJST(c.convertedAt);
      cvCountByDate.set(key, (cvCountByDate.get(key) ?? 0) + 1);
      billingByDate.set(key, (billingByDate.get(key) ?? 0) + c.billingAmount);
    });

  const rows: DailyReportRow[] = enumerateDateKeys(fromDateKey, toDateKey).map((key) => {
    const friendCount = friendCountByDate.get(key) ?? 0;
    const cvCount = cvCountByDate.get(key) ?? 0;
    const adMetrics = adMetricsByDate.get(key);
    const pvCount = adMetrics?.pvCount ?? null;
    const impCount = adMetrics?.impCount ?? null;
    const clCount = adMetrics?.clCount ?? null;
    const impRate =
      impCount !== null && pvCount !== null && pvCount > 0 ? Math.round((impCount / pvCount) * 1000) / 10 : null;
    const clRate =
      clCount !== null && impCount !== null && impCount > 0 ? Math.round((clCount / impCount) * 1000) / 10 : null;
    const friendAddRate =
      clCount !== null && clCount > 0 ? Math.round((friendCount / clCount) * 1000) / 10 : null;
    return {
      date: key,
      pvCount,
      impCount,
      impRate,
      clCount,
      clRate,
      friendCount,
      friendAddRate,
      cvCount,
      cvr: friendCount > 0 ? Math.round((cvCount / friendCount) * 1000) / 10 : null,
      billingAmount: billingByDate.get(key) ?? 0,
      memo: adMetrics?.memo ?? "",
    };
  });

  // 新しい日付が上に来るように並べる
  return rows.reverse();
}

// sourceId → ポップアップ名(流入経路管理で登録した「ポップアップ」要素)のMapを返す。
// sourcesは広告registration数程度の小さな設定コレクションのため、全件取得している
// (他の一覧画面での流入経路名解決と同じ考え方)。
// ポップアップが未設定の流入経路、および該当する流入経路が見当たらない場合は「(未設定)」として扱う。
export async function getPopupLabelMap(): Promise<Map<string, string>> {
  const sources = await getAllSources();
  const map = new Map<string, string>();
  sources.forEach((s) => {
    map.set(s.sourceId, s.popup?.trim() || "(未設定)");
  });
  return map;
}

export type PopupDailyReportRow = {
  date: string; // YYYY-MM-DD (日本時間)
  popup: string; // ポップアップ名。未設定は「(未設定)」。CSV等で手動追加した成果も、流入経路名が一致すれば、その流入経路の値で集計する(一致しなければ「(未設定)」)
  pvCount: number | null; // 未インポート・未入力の(日付, ポップアップ)はnull
  impCount: number | null; // 未インポートの(日付, ポップアップ)はnull
  clCount: number | null; // 未インポートの(日付, ポップアップ)はnull
  impRate: number | null; // パーセント(imp数 ÷ PV数)。imp数・PV数のいずれかが未インポート・未入力、もしくはPV数が0の場合はnull
  clRate: number | null; // パーセント(CL数 ÷ imp数)。いずれかが未インポート、もしくはimp数が0の場合はnull
  friendCount: number;
  friendAddRate: number | null; // パーセント(友だち追加数 ÷ CL数)。CL数が未インポート、もしくは0の場合はnull
  cvCount: number;
  cvr: number | null; // パーセント(成果数 ÷ 友だち追加数)。友だち追加数が0の場合はnull
  billingAmount: number; // 請求額(円)= 成果(非表示を除く)ごとの、その広告の成果単価の合計
};

// 指定した日付範囲(日本時間, YYYY-MM-DD)に含まれるポップアップ別imp数・CL数をまとめて取得する。
// daily_popup_ad_metricsコレクションは日付範囲で絞り込んで問い合わせるため、
// 範囲が伸びてもポップアップ数×日数の範囲でしか読み取り件数が増えない(無制限スキャンにはならない)。
export async function getPopupAdMetricsInRange(
  fromDateKey: string,
  toDateKey: string
): Promise<Map<string, DailyPopupAdMetricsDoc>> {
  const snap = await adminDb
    .collection("daily_popup_ad_metrics")
    .where("date", ">=", fromDateKey)
    .where("date", "<=", toDateKey)
    .get();
  const map = new Map<string, DailyPopupAdMetricsDoc>();
  snap.docs.forEach((d) => {
    const m = d.data() as DailyPopupAdMetricsDoc;
    map.set(`${m.date}__${m.popup}`, m);
  });
  return map;
}

// 指定した日付範囲(日本時間, YYYY-MM-DD)について、ポップアップ別・日別に
// imp数・CL数・CL率・友だち追加数・友だち追加率・成果数(非表示を除く)・成果率を集計する。
// 該当データが1件も無い(日付, ポップアップ)の組み合わせも0件の行として含める
// (登場するポップアップ×すべての日付、で欠けている組み合わせがないようにするため)。
// imp数・CL数のインポートでしか登場しないポップアップ(まだ友だち追加・成果の実績がないもの)も
// 表示対象に含める。
export function buildPopupDailyReport(
  fromDateKey: string,
  toDateKey: string,
  friends: FriendDoc[],
  cvEntries: EffectiveCvEntry[],
  popupLabelMap: Map<string, string>,
  adMetrics: Map<string, DailyPopupAdMetricsDoc> = new Map(),
  // このポップアップ専用のPV数が未入力の場合に使う、その日の合計PV数(daily_ad_metrics)。
  // PVは通常ポップアップ単位では分かれておらず(同じページを見た人数の合計のため)、
  // 個別に手動入力・修正していない限りは日次レポートの合計をそのまま表示に使う。
  dailyAdMetricsByDate: Map<string, DailyAdMetricsDoc> = new Map()
): PopupDailyReportRow[] {
  const popupOf = (sourceId: string | undefined): string =>
    sourceId ? popupLabelMap.get(sourceId) ?? "(未設定)" : "(未設定)";

  const popups = new Set<string>();
  const friendCountByKey = new Map<string, number>(); // key: `${dateKey}__${popup}`
  friends.forEach((f) => {
    const popup = popupOf(f.sourceId);
    popups.add(popup);
    const key = `${dateKeyJST(f.addedAt)}__${popup}`;
    friendCountByKey.set(key, (friendCountByKey.get(key) ?? 0) + 1);
  });

  const cvCountByKey = new Map<string, number>();
  const billingByKey = new Map<string, number>();
  cvEntries
    .filter((c) => !c.hidden)
    .forEach((c) => {
      // 成果時点で最新だった流入経路(latestSourceId)を優先し、
      // 再クリックが一度も無い場合は友だち追加時(ファーストタッチ)のsourceIdにフォールバックする。
      const popup = popupOf(c.latestSourceId ?? c.sourceId);
      popups.add(popup);
      const key = `${dateKeyJST(c.convertedAt)}__${popup}`;
      cvCountByKey.set(key, (cvCountByKey.get(key) ?? 0) + 1);
      billingByKey.set(key, (billingByKey.get(key) ?? 0) + c.billingAmount);
    });

  adMetrics.forEach((m) => popups.add(m.popup));

  const sortedPopups = Array.from(popups).sort((a, b) => {
    // 「(未設定)」は末尾に固定し、それ以外は五十音・アルファベット順
    const isSpecialA = a.startsWith("(");
    const isSpecialB = b.startsWith("(");
    if (isSpecialA !== isSpecialB) return isSpecialA ? 1 : -1;
    return a.localeCompare(b, "ja");
  });

  // 新しい日付が上に来るように、日付キー自体を先に降順へ並べ替えてから組み立てる
  // (単純に配列全体を反転すると、同じ日付内でのポップアップの並び順まで反転してしまうため)
  const orderedDateKeys = enumerateDateKeys(fromDateKey, toDateKey).reverse();

  const rows: PopupDailyReportRow[] = [];
  orderedDateKeys.forEach((dateKey) => {
    sortedPopups.forEach((popup) => {
      const key = `${dateKey}__${popup}`;
      const friendCount = friendCountByKey.get(key) ?? 0;
      const cvCount = cvCountByKey.get(key) ?? 0;
      const metrics = adMetrics.get(key);
      const pvCount = metrics?.pvCount ?? dailyAdMetricsByDate.get(dateKey)?.pvCount ?? null;
      const impCount = metrics?.impCount ?? null;
      const clCount = metrics?.clCount ?? null;
      const impRate =
        impCount !== null && pvCount !== null && pvCount > 0 ? Math.round((impCount / pvCount) * 1000) / 10 : null;
      const clRate =
        clCount !== null && impCount !== null && impCount > 0 ? Math.round((clCount / impCount) * 1000) / 10 : null;
      const friendAddRate =
        clCount !== null && clCount > 0 ? Math.round((friendCount / clCount) * 1000) / 10 : null;
      rows.push({
        date: dateKey,
        popup,
        pvCount,
        impCount,
        clCount,
        impRate,
        clRate,
        friendCount,
        friendAddRate,
        cvCount,
        cvr: friendCount > 0 ? Math.round((cvCount / friendCount) * 1000) / 10 : null,
        billingAmount: billingByKey.get(key) ?? 0,
      });
    });
  });

  return rows;
}

// sourceId → シナリオ名(流入経路管理で登録した「シナリオ」要素)のMapを返す。
// getPopupLabelMapと同じ考え方(sourcesは小さな設定コレクションのため全件取得)。
// シナリオが未設定の流入経路、および該当する流入経路が見当たらない場合は「(未設定)」として扱う。
export async function getScenarioLabelMap(): Promise<Map<string, string>> {
  const sources = await getAllSources();
  const map = new Map<string, string>();
  sources.forEach((s) => {
    map.set(s.sourceId, s.scenario?.trim() || "(未設定)");
  });
  return map;
}

export type ScenarioDailyReportRow = {
  date: string; // YYYY-MM-DD (日本時間)
  scenario: string; // シナリオ名。未設定は「(未設定)」。CSV等で手動追加した成果も、流入経路名が一致すれば、その流入経路の値で集計する(一致しなければ「(未設定)」)
  pvCount: number | null; // 未入力の(日付, シナリオ)はnull
  impCount: number | null;
  clCount: number | null;
  impRate: number | null; // パーセント(imp数 ÷ PV数)。imp数・PV数のいずれかが未インポート・未入力、もしくはPV数が0の場合はnull
  clRate: number | null;
  friendCount: number;
  friendAddRate: number | null;
  cvCount: number;
  cvr: number | null;
  billingAmount: number; // 請求額(円)= 成果(非表示を除く)ごとの、その広告の成果単価の合計
};

// 指定した日付範囲(日本時間, YYYY-MM-DD)に含まれるシナリオ別imp数・CL数をまとめて取得する。
// daily_scenario_ad_metricsコレクションは日付範囲で絞り込んで問い合わせるため、
// 範囲が伸びてもシナリオ数×日数の範囲でしか読み取り件数が増えない(無制限スキャンにはならない)。
export async function getScenarioAdMetricsInRange(
  fromDateKey: string,
  toDateKey: string
): Promise<Map<string, DailyScenarioAdMetricsDoc>> {
  const snap = await adminDb
    .collection("daily_scenario_ad_metrics")
    .where("date", ">=", fromDateKey)
    .where("date", "<=", toDateKey)
    .get();
  const map = new Map<string, DailyScenarioAdMetricsDoc>();
  snap.docs.forEach((d) => {
    const m = d.data() as DailyScenarioAdMetricsDoc;
    map.set(`${m.date}__${m.scenario}`, m);
  });
  return map;
}

// buildPopupDailyReportと同じロジックを「シナリオ」単位に置き換えたもの。
export function buildScenarioDailyReport(
  fromDateKey: string,
  toDateKey: string,
  friends: FriendDoc[],
  cvEntries: EffectiveCvEntry[],
  scenarioLabelMap: Map<string, string>,
  adMetrics: Map<string, DailyScenarioAdMetricsDoc> = new Map(),
  // buildPopupDailyReportと同じ考え方(このシナリオ専用のPV数が未入力の場合、日次レポートの合計を使う)
  dailyAdMetricsByDate: Map<string, DailyAdMetricsDoc> = new Map()
): ScenarioDailyReportRow[] {
  const scenarioOf = (sourceId: string | undefined): string =>
    sourceId ? scenarioLabelMap.get(sourceId) ?? "(未設定)" : "(未設定)";

  const scenarios = new Set<string>();
  const friendCountByKey = new Map<string, number>(); // key: `${dateKey}__${scenario}`
  friends.forEach((f) => {
    const scenario = scenarioOf(f.sourceId);
    scenarios.add(scenario);
    const key = `${dateKeyJST(f.addedAt)}__${scenario}`;
    friendCountByKey.set(key, (friendCountByKey.get(key) ?? 0) + 1);
  });

  const cvCountByKey = new Map<string, number>();
  const billingByKey = new Map<string, number>();
  cvEntries
    .filter((c) => !c.hidden)
    .forEach((c) => {
      // 成果時点で最新だった流入経路(latestSourceId)を優先し、再クリックが無い場合はsourceIdにフォールバックする。
      const scenario = scenarioOf(c.latestSourceId ?? c.sourceId);
      scenarios.add(scenario);
      const key = `${dateKeyJST(c.convertedAt)}__${scenario}`;
      cvCountByKey.set(key, (cvCountByKey.get(key) ?? 0) + 1);
      billingByKey.set(key, (billingByKey.get(key) ?? 0) + c.billingAmount);
    });

  adMetrics.forEach((m) => scenarios.add(m.scenario));

  const sortedScenarios = Array.from(scenarios).sort((a, b) => {
    const isSpecialA = a.startsWith("(");
    const isSpecialB = b.startsWith("(");
    if (isSpecialA !== isSpecialB) return isSpecialA ? 1 : -1;
    return a.localeCompare(b, "ja");
  });

  const orderedDateKeys = enumerateDateKeys(fromDateKey, toDateKey).reverse();

  const rows: ScenarioDailyReportRow[] = [];
  orderedDateKeys.forEach((dateKey) => {
    sortedScenarios.forEach((scenario) => {
      const key = `${dateKey}__${scenario}`;
      const friendCount = friendCountByKey.get(key) ?? 0;
      const cvCount = cvCountByKey.get(key) ?? 0;
      const metrics = adMetrics.get(key);
      const pvCount = metrics?.pvCount ?? dailyAdMetricsByDate.get(dateKey)?.pvCount ?? null;
      const impCount = metrics?.impCount ?? null;
      const clCount = metrics?.clCount ?? null;
      const impRate =
        impCount !== null && pvCount !== null && pvCount > 0 ? Math.round((impCount / pvCount) * 1000) / 10 : null;
      const clRate =
        clCount !== null && impCount !== null && impCount > 0 ? Math.round((clCount / impCount) * 1000) / 10 : null;
      const friendAddRate =
        clCount !== null && clCount > 0 ? Math.round((friendCount / clCount) * 1000) / 10 : null;
      rows.push({
        date: dateKey,
        scenario,
        pvCount,
        impCount,
        clCount,
        impRate,
        clRate,
        friendCount,
        friendAddRate,
        cvCount,
        cvr: friendCount > 0 ? Math.round((cvCount / friendCount) * 1000) / 10 : null,
        billingAmount: billingByKey.get(key) ?? 0,
      });
    });
  });

  return rows;
}

// sourceId → 離脱地点名(流入経路管理で登録した「離脱地点」要素)のMapを返す。
// getPopupLabelMap・getScenarioLabelMapと同じ考え方(sourcesは小さな設定コレクションのため全件取得)。
// 離脱地点が未設定の流入経路、および該当する流入経路が見当たらない場合は「(未設定)」として扱う。
export async function getExitPointLabelMap(): Promise<Map<string, string>> {
  const sources = await getAllSources();
  const map = new Map<string, string>();
  sources.forEach((s) => {
    map.set(s.sourceId, s.exitPoint?.trim() || "(未設定)");
  });
  return map;
}

export type ExitPointDailyReportRow = {
  date: string; // YYYY-MM-DD (日本時間)
  exitPoint: string; // 離脱地点名。未設定は「(未設定)」。CSV等で手動追加した成果も、流入経路名が一致すれば、その流入経路の値で集計する(一致しなければ「(未設定)」)
  pvCount: number | null; // 未インポート・未入力の(日付, 離脱地点)はnull
  impCount: number | null;
  clCount: number | null;
  impRate: number | null; // パーセント(imp数 ÷ PV数)。imp数・PV数のいずれかが未インポート・未入力、もしくはPV数が0の場合はnull
  clRate: number | null;
  friendCount: number;
  friendAddRate: number | null;
  cvCount: number;
  cvr: number | null;
  billingAmount: number; // 請求額(円)= 成果(非表示を除く)ごとの、その広告の成果単価の合計
};

// 指定した日付範囲(日本時間, YYYY-MM-DD)に含まれる離脱地点別imp数・CL数をまとめて取得する。
// daily_exit_point_ad_metricsコレクションは日付範囲で絞り込んで問い合わせるため、
// 範囲が伸びても離脱地点数×日数の範囲でしか読み取り件数が増えない(無制限スキャンにはならない)。
export async function getExitPointAdMetricsInRange(
  fromDateKey: string,
  toDateKey: string
): Promise<Map<string, DailyExitPointAdMetricsDoc>> {
  const snap = await adminDb
    .collection("daily_exit_point_ad_metrics")
    .where("date", ">=", fromDateKey)
    .where("date", "<=", toDateKey)
    .get();
  const map = new Map<string, DailyExitPointAdMetricsDoc>();
  snap.docs.forEach((d) => {
    const m = d.data() as DailyExitPointAdMetricsDoc;
    map.set(`${m.date}__${m.exitPoint}`, m);
  });
  return map;
}

// buildPopupDailyReport・buildScenarioDailyReportと同じロジックを「離脱地点」単位に置き換えたもの。
export function buildExitPointDailyReport(
  fromDateKey: string,
  toDateKey: string,
  friends: FriendDoc[],
  cvEntries: EffectiveCvEntry[],
  exitPointLabelMap: Map<string, string>,
  adMetrics: Map<string, DailyExitPointAdMetricsDoc> = new Map(),
  // buildPopupDailyReportと同じ考え方(この離脱地点専用のPV数が未入力の場合、日次レポートの合計を使う)
  dailyAdMetricsByDate: Map<string, DailyAdMetricsDoc> = new Map()
): ExitPointDailyReportRow[] {
  const exitPointOf = (sourceId: string | undefined): string =>
    sourceId ? exitPointLabelMap.get(sourceId) ?? "(未設定)" : "(未設定)";

  const exitPoints = new Set<string>();
  const friendCountByKey = new Map<string, number>(); // key: `${dateKey}__${exitPoint}`
  friends.forEach((f) => {
    const exitPoint = exitPointOf(f.sourceId);
    exitPoints.add(exitPoint);
    const key = `${dateKeyJST(f.addedAt)}__${exitPoint}`;
    friendCountByKey.set(key, (friendCountByKey.get(key) ?? 0) + 1);
  });

  const cvCountByKey = new Map<string, number>();
  const billingByKey = new Map<string, number>();
  cvEntries
    .filter((c) => !c.hidden)
    .forEach((c) => {
      // 成果時点で最新だった流入経路(latestSourceId)を優先し、再クリックが無い場合はsourceIdにフォールバックする。
      const exitPoint = exitPointOf(c.latestSourceId ?? c.sourceId);
      exitPoints.add(exitPoint);
      const key = `${dateKeyJST(c.convertedAt)}__${exitPoint}`;
      cvCountByKey.set(key, (cvCountByKey.get(key) ?? 0) + 1);
      billingByKey.set(key, (billingByKey.get(key) ?? 0) + c.billingAmount);
    });

  adMetrics.forEach((m) => exitPoints.add(m.exitPoint));

  const sortedExitPoints = Array.from(exitPoints).sort((a, b) => {
    const isSpecialA = a.startsWith("(");
    const isSpecialB = b.startsWith("(");
    if (isSpecialA !== isSpecialB) return isSpecialA ? 1 : -1;
    return a.localeCompare(b, "ja");
  });

  const orderedDateKeys = enumerateDateKeys(fromDateKey, toDateKey).reverse();

  const rows: ExitPointDailyReportRow[] = [];
  orderedDateKeys.forEach((dateKey) => {
    sortedExitPoints.forEach((exitPoint) => {
      const key = `${dateKey}__${exitPoint}`;
      const friendCount = friendCountByKey.get(key) ?? 0;
      const cvCount = cvCountByKey.get(key) ?? 0;
      const metrics = adMetrics.get(key);
      const pvCount = metrics?.pvCount ?? dailyAdMetricsByDate.get(dateKey)?.pvCount ?? null;
      const impCount = metrics?.impCount ?? null;
      const clCount = metrics?.clCount ?? null;
      const impRate =
        impCount !== null && pvCount !== null && pvCount > 0 ? Math.round((impCount / pvCount) * 1000) / 10 : null;
      const clRate =
        clCount !== null && impCount !== null && impCount > 0 ? Math.round((clCount / impCount) * 1000) / 10 : null;
      const friendAddRate =
        clCount !== null && clCount > 0 ? Math.round((friendCount / clCount) * 1000) / 10 : null;
      rows.push({
        date: dateKey,
        exitPoint,
        pvCount,
        impCount,
        clCount,
        impRate,
        clRate,
        friendCount,
        friendAddRate,
        cvCount,
        cvr: friendCount > 0 ? Math.round((cvCount / friendCount) * 1000) / 10 : null,
        billingAmount: billingByKey.get(key) ?? 0,
      });
    });
  });

  return rows;
}

// sourceId → 訴求名(流入経路管理で登録した「訴求」要素)のMapを返す。
// getPopupLabelMap等と同じ考え方(sourcesは小さな設定コレクションのため全件取得)。
// 訴求が未設定の流入経路、および該当する流入経路が見当たらない場合は「(未設定)」として扱う。
export async function getAppealLabelMap(): Promise<Map<string, string>> {
  const sources = await getAllSources();
  const map = new Map<string, string>();
  sources.forEach((s) => {
    map.set(s.sourceId, s.appeal?.trim() || "(未設定)");
  });
  return map;
}

export type AppealDailyReportRow = {
  date: string; // YYYY-MM-DD (日本時間)
  appeal: string; // 訴求名。未設定は「(未設定)」。CSV等で手動追加した成果も、流入経路名が一致すれば、その流入経路の値で集計する(一致しなければ「(未設定)」)
  pvCount: number | null; // 未インポート・未入力の(日付, 訴求)はnull
  impCount: number | null;
  clCount: number | null;
  impRate: number | null; // パーセント(imp数 ÷ PV数)。imp数・PV数のいずれかが未インポート・未入力、もしくはPV数が0の場合はnull
  clRate: number | null;
  friendCount: number;
  friendAddRate: number | null;
  cvCount: number;
  cvr: number | null;
  billingAmount: number; // 請求額(円)= 成果(非表示を除く)ごとの、その広告の成果単価の合計
};

// 指定した日付範囲(日本時間, YYYY-MM-DD)に含まれる訴求別imp数・CL数をまとめて取得する。
// daily_appeal_ad_metricsコレクションは日付範囲で絞り込んで問い合わせるため、
// 範囲が伸びても訴求数×日数の範囲でしか読み取り件数が増えない(無制限スキャンにはならない)。
export async function getAppealAdMetricsInRange(
  fromDateKey: string,
  toDateKey: string
): Promise<Map<string, DailyAppealAdMetricsDoc>> {
  const snap = await adminDb
    .collection("daily_appeal_ad_metrics")
    .where("date", ">=", fromDateKey)
    .where("date", "<=", toDateKey)
    .get();
  const map = new Map<string, DailyAppealAdMetricsDoc>();
  snap.docs.forEach((d) => {
    const m = d.data() as DailyAppealAdMetricsDoc;
    map.set(`${m.date}__${m.appeal}`, m);
  });
  return map;
}

// buildPopupDailyReport等と同じロジックを「訴求」単位に置き換えたもの。
export function buildAppealDailyReport(
  fromDateKey: string,
  toDateKey: string,
  friends: FriendDoc[],
  cvEntries: EffectiveCvEntry[],
  appealLabelMap: Map<string, string>,
  adMetrics: Map<string, DailyAppealAdMetricsDoc> = new Map()
): AppealDailyReportRow[] {
  const appealOf = (sourceId: string | undefined): string =>
    sourceId ? appealLabelMap.get(sourceId) ?? "(未設定)" : "(未設定)";

  const appeals = new Set<string>();
  const friendCountByKey = new Map<string, number>(); // key: `${dateKey}__${appeal}`
  friends.forEach((f) => {
    const appeal = appealOf(f.sourceId);
    appeals.add(appeal);
    const key = `${dateKeyJST(f.addedAt)}__${appeal}`;
    friendCountByKey.set(key, (friendCountByKey.get(key) ?? 0) + 1);
  });

  const cvCountByKey = new Map<string, number>();
  const billingByKey = new Map<string, number>();
  cvEntries
    .filter((c) => !c.hidden)
    .forEach((c) => {
      // 成果時点で最新だった流入経路(latestSourceId)を優先し、再クリックが無い場合はsourceIdにフォールバックする。
      const appeal = appealOf(c.latestSourceId ?? c.sourceId);
      appeals.add(appeal);
      const key = `${dateKeyJST(c.convertedAt)}__${appeal}`;
      cvCountByKey.set(key, (cvCountByKey.get(key) ?? 0) + 1);
      billingByKey.set(key, (billingByKey.get(key) ?? 0) + c.billingAmount);
    });

  adMetrics.forEach((m) => appeals.add(m.appeal));

  const sortedAppeals = Array.from(appeals).sort((a, b) => {
    const isSpecialA = a.startsWith("(");
    const isSpecialB = b.startsWith("(");
    if (isSpecialA !== isSpecialB) return isSpecialA ? 1 : -1;
    return a.localeCompare(b, "ja");
  });

  const orderedDateKeys = enumerateDateKeys(fromDateKey, toDateKey).reverse();

  const rows: AppealDailyReportRow[] = [];
  orderedDateKeys.forEach((dateKey) => {
    sortedAppeals.forEach((appeal) => {
      const key = `${dateKey}__${appeal}`;
      const friendCount = friendCountByKey.get(key) ?? 0;
      const cvCount = cvCountByKey.get(key) ?? 0;
      const metrics = adMetrics.get(key);
      const pvCount = metrics?.pvCount ?? null;
      const impCount = metrics?.impCount ?? null;
      const clCount = metrics?.clCount ?? null;
      const impRate =
        impCount !== null && pvCount !== null && pvCount > 0 ? Math.round((impCount / pvCount) * 1000) / 10 : null;
      const clRate =
        clCount !== null && impCount !== null && impCount > 0 ? Math.round((clCount / impCount) * 1000) / 10 : null;
      const friendAddRate =
        clCount !== null && clCount > 0 ? Math.round((friendCount / clCount) * 1000) / 10 : null;
      rows.push({
        date: dateKey,
        appeal,
        pvCount,
        impCount,
        clCount,
        impRate,
        clRate,
        friendCount,
        friendAddRate,
        cvCount,
        cvr: friendCount > 0 ? Math.round((cvCount / friendCount) * 1000) / 10 : null,
        billingAmount: billingByKey.get(key) ?? 0,
      });
    });
  });

  return rows;
}

// sourceId → 「ポップアップ / シナリオ」のラベルのMapを返す(月次レポートの「ポップアップ×シナリオ別」用)。
// getPopupLabelMap・getScenarioLabelMapと同じ考え方(sourcesは小さな設定コレクションのため全件取得)。
// ポップアップ・シナリオのいずれかが未設定の場合は、その部分だけ「(未設定)」として組み合わせる。
export async function getPopupScenarioLabelMap(): Promise<Map<string, string>> {
  const sources = await getAllSources();
  const map = new Map<string, string>();
  sources.forEach((s) => {
    const popup = s.popup?.trim() || "(未設定)";
    const scenario = s.scenario?.trim() || "(未設定)";
    map.set(s.sourceId, `${popup} / ${scenario}`);
  });
  return map;
}

// sourceId → 流入経路の名前(設置先・訴求・ポップアップ・シナリオ・離脱地点・中間ページ・その他を
// すべて結合したフルネーム。src/lib/source-name.tsのbuildSourceName()で生成されたもの)のMapを返す。
// 月次レポートの「設置先×訴求×離脱地点×ポップアップ×シナリオ×中間別」で使う
// (この6要素の組み合わせ単位は、流入経路そのものの単位と同じであるため、sources.nameをそのままラベルに使う)。
export async function getSourceNameLabelMap(): Promise<Map<string, string>> {
  const sources = await getAllSources();
  const map = new Map<string, string>();
  sources.forEach((s) => {
    map.set(s.sourceId, s.name?.trim() || "(未設定)");
  });
  return map;
}

// 「現在稼働中」判定の共通部分: 直近N日間(recentDateKeyRangeで決める範囲)の友だち追加・成果(非表示を除く)から
// 登場するラベルを集める。ad_metrics(CSV取り込み)側の判定は呼び出し側で追加する。
async function activeLabelsFromFriendsAndCv(
  fromMs: number,
  toMs: number,
  labelOf: (sourceId: string | undefined) => string
): Promise<Set<string>> {
  const [friends, cvEntries] = await Promise.all([getReportFriends(fromMs, toMs), getReportCvEntries(fromMs, toMs)]);
  const active = new Set<string>();
  friends.forEach((f) => active.add(labelOf(f.sourceId)));
  cvEntries
    .filter((c) => !c.hidden)
    .forEach((c) => active.add(labelOf(c.latestSourceId ?? c.sourceId)));
  return active;
}

// 「現在稼働中」のポップアップ名の集合。直近ACTIVE_WINDOW_DAYS日間の友だち追加・成果・imp数/CL数取り込みの
// いずれかに登場するポップアップを「稼働中」とみなす(表示期間の指定とは関係なく、常に直近の実データで判定する)。
export async function getActivePopupLabels(popupLabelMap: Map<string, string>): Promise<Set<string>> {
  const { fromDateKey, toDateKey } = recentDateKeyRange(ACTIVE_WINDOW_DAYS);
  const fromMs = new Date(`${fromDateKey}T00:00:00+09:00`).getTime();
  const toMs = new Date(`${toDateKey}T23:59:59.999+09:00`).getTime();
  const popupOf = (sourceId: string | undefined) => (sourceId ? popupLabelMap.get(sourceId) ?? "(未設定)" : "(未設定)");
  const [active, adMetrics] = await Promise.all([
    activeLabelsFromFriendsAndCv(fromMs, toMs, popupOf),
    getPopupAdMetricsInRange(fromDateKey, toDateKey),
  ]);
  adMetrics.forEach((m) => active.add(m.popup));
  return active;
}

// getActivePopupLabelsと同じ考え方の「シナリオ」版。
export async function getActiveScenarioLabels(scenarioLabelMap: Map<string, string>): Promise<Set<string>> {
  const { fromDateKey, toDateKey } = recentDateKeyRange(ACTIVE_WINDOW_DAYS);
  const fromMs = new Date(`${fromDateKey}T00:00:00+09:00`).getTime();
  const toMs = new Date(`${toDateKey}T23:59:59.999+09:00`).getTime();
  const scenarioOf = (sourceId: string | undefined) =>
    sourceId ? scenarioLabelMap.get(sourceId) ?? "(未設定)" : "(未設定)";
  const [active, adMetrics] = await Promise.all([
    activeLabelsFromFriendsAndCv(fromMs, toMs, scenarioOf),
    getScenarioAdMetricsInRange(fromDateKey, toDateKey),
  ]);
  adMetrics.forEach((m) => active.add(m.scenario));
  return active;
}

// getActivePopupLabelsと同じ考え方の「離脱地点」版。
export async function getActiveExitPointLabels(exitPointLabelMap: Map<string, string>): Promise<Set<string>> {
  const { fromDateKey, toDateKey } = recentDateKeyRange(ACTIVE_WINDOW_DAYS);
  const fromMs = new Date(`${fromDateKey}T00:00:00+09:00`).getTime();
  const toMs = new Date(`${toDateKey}T23:59:59.999+09:00`).getTime();
  const exitPointOf = (sourceId: string | undefined) =>
    sourceId ? exitPointLabelMap.get(sourceId) ?? "(未設定)" : "(未設定)";
  const [active, adMetrics] = await Promise.all([
    activeLabelsFromFriendsAndCv(fromMs, toMs, exitPointOf),
    getExitPointAdMetricsInRange(fromDateKey, toDateKey),
  ]);
  adMetrics.forEach((m) => active.add(m.exitPoint));
  return active;
}

// getActivePopupLabelsと同じ考え方の「訴求」版。
export async function getActiveAppealLabels(appealLabelMap: Map<string, string>): Promise<Set<string>> {
  const { fromDateKey, toDateKey } = recentDateKeyRange(ACTIVE_WINDOW_DAYS);
  const fromMs = new Date(`${fromDateKey}T00:00:00+09:00`).getTime();
  const toMs = new Date(`${toDateKey}T23:59:59.999+09:00`).getTime();
  const appealOf = (sourceId: string | undefined) => (sourceId ? appealLabelMap.get(sourceId) ?? "(未設定)" : "(未設定)");
  const [active, adMetrics] = await Promise.all([
    activeLabelsFromFriendsAndCv(fromMs, toMs, appealOf),
    getAppealAdMetricsInRange(fromDateKey, toDateKey),
  ]);
  adMetrics.forEach((m) => active.add(m.appeal));
  return active;
}

// ポップアップ×シナリオ別・設置先×訴求×離脱地点×ポップアップ×シナリオ×中間別の月次レポート用。
// この2つの組み合わせ軸はad_metrics(PV数・imp数・CL数)の取り込みが無いため、
// 直近ACTIVE_WINDOW_DAYS日間の友だち追加・成果のみで「稼働中」を判定する。
export async function getActiveComboLabels(labelMap: Map<string, string>): Promise<Set<string>> {
  const { fromDateKey, toDateKey } = recentDateKeyRange(ACTIVE_WINDOW_DAYS);
  const fromMs = new Date(`${fromDateKey}T00:00:00+09:00`).getTime();
  const toMs = new Date(`${toDateKey}T23:59:59.999+09:00`).getTime();
  const labelOf = (sourceId: string | undefined) => (sourceId ? labelMap.get(sourceId) ?? "(未設定)" : "(未設定)");
  return activeLabelsFromFriendsAndCv(fromMs, toMs, labelOf);
}

// 指定した日付範囲(日本時間, YYYY-MM-DD)に含まれる「流入経路の名前」別imp数・CL数をまとめて取得する
// (daily_source_ad_metrics。getPopupAdMetricsInRangeと同じ考え方で、日付範囲で絞り込んで問い合わせる)。
export async function getSourceAdMetricsInRange(
  fromDateKey: string,
  toDateKey: string
): Promise<Map<string, DailySourceAdMetricsDoc>> {
  const snap = await adminDb
    .collection("daily_source_ad_metrics")
    .where("date", ">=", fromDateKey)
    .where("date", "<=", toDateKey)
    .get();
  const map = new Map<string, DailySourceAdMetricsDoc>();
  snap.docs.forEach((d) => {
    const m = d.data() as DailySourceAdMetricsDoc;
    map.set(`${m.date}__${m.sourceName}`, m);
  });
  return map;
}

// 設置先×訴求×離脱地点×ポップアップ×シナリオ×中間別月次レポート用の「現在稼働中」判定。
// 直近ACTIVE_WINDOW_DAYS日間の友だち追加・成果・imp数/CL数の取り込みのいずれかに登場する流入経路の名前を稼働中とみなす。
export async function getActiveSourceLabels(labelMap: Map<string, string>): Promise<Set<string>> {
  const { fromDateKey, toDateKey } = recentDateKeyRange(ACTIVE_WINDOW_DAYS);
  const fromMs = new Date(`${fromDateKey}T00:00:00+09:00`).getTime();
  const toMs = new Date(`${toDateKey}T23:59:59.999+09:00`).getTime();
  const labelOf = (sourceId: string | undefined) => (sourceId ? labelMap.get(sourceId) ?? "(未設定)" : "(未設定)");
  const [active, adMetrics] = await Promise.all([
    activeLabelsFromFriendsAndCv(fromMs, toMs, labelOf),
    getSourceAdMetricsInRange(fromDateKey, toDateKey),
  ]);
  adMetrics.forEach((m) => active.add(m.sourceName));
  return active;
}

// 指定した日付範囲(日本時間, YYYY-MM-DD)に含まれる「ポップアップ / シナリオ」別imp数・CL数をまとめて取得する
// (daily_popup_scenario_ad_metrics。getSourceAdMetricsInRangeと同じ考え方)。
export async function getPopupScenarioAdMetricsInRange(
  fromDateKey: string,
  toDateKey: string
): Promise<Map<string, DailyPopupScenarioAdMetricsDoc>> {
  const snap = await adminDb
    .collection("daily_popup_scenario_ad_metrics")
    .where("date", ">=", fromDateKey)
    .where("date", "<=", toDateKey)
    .get();
  const map = new Map<string, DailyPopupScenarioAdMetricsDoc>();
  snap.docs.forEach((d) => {
    const m = d.data() as DailyPopupScenarioAdMetricsDoc;
    map.set(`${m.date}__${m.label}`, m);
  });
  return map;
}

// ポップアップ×シナリオ別月次レポート用の「現在稼働中」判定(友だち追加・成果・imp数/CL数の取り込みのいずれか)。
export async function getActivePopupScenarioLabels(labelMap: Map<string, string>): Promise<Set<string>> {
  const { fromDateKey, toDateKey } = recentDateKeyRange(ACTIVE_WINDOW_DAYS);
  const fromMs = new Date(`${fromDateKey}T00:00:00+09:00`).getTime();
  const toMs = new Date(`${toDateKey}T23:59:59.999+09:00`).getTime();
  const labelOf = (sourceId: string | undefined) => (sourceId ? labelMap.get(sourceId) ?? "(未設定)" : "(未設定)");
  const [active, adMetrics] = await Promise.all([
    activeLabelsFromFriendsAndCv(fromMs, toMs, labelOf),
    getPopupScenarioAdMetricsInRange(fromDateKey, toDateKey),
  ]);
  adMetrics.forEach((m) => active.add(m.label));
  return active;
}
