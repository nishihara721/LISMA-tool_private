// 「データ」メニューの新しい専用ページ(/admin/reports/sheet-export)から、
// 日次・ポップアップ別・シナリオ別・訴求別・離脱地点別の5つのレポートを、指定した期間について
// まとめて計算し、スプレッドシート送信用の形(GASのmergeモードがそのまま読み込める形)に変換するための関数群。
//
// 実際の送信(GAS Webアプリへのfetch)はAPI Route側(app/api/report/sheet-export/route.ts)で行う。
// ここでは「計算」と「形の変換」だけを担当する。
//
// 指標の並び順は、スプレッドシート側(docs/setup.mdのmergeReportSheet)が「先頭5個=ポップアップ数値・
// 次の2個=LINE公式数値・残り=成果」という固定の並びを前提に親項目(見出しの結合セル)を組み立てるため、
// 絶対にこの並び(pvCount, impCount, impRate, clCount, clRate, friendCount, friendAddRate, cvCount, cvr, (billingAmount))
// を崩さないこと。

import {
  buildAppealDailyReport,
  buildDailyReport,
  buildExitPointDailyReport,
  buildPopupDailyReport,
  buildScenarioDailyReport,
  enumerateDateKeys,
  getAdMetricsByDates,
  getAppealAdMetricsInRange,
  getAppealLabelMap,
  getExitPointAdMetricsInRange,
  getExitPointLabelMap,
  getPopupAdMetricsInRange,
  getPopupLabelMap,
  getReportCvEntries,
  getReportFriends,
  getScenarioAdMetricsInRange,
  getScenarioLabelMap,
} from "./report-cv";

// スプレッドシート側に書き込む指標の列見出し。
// 請求額は日次レポート(デイリー)のみに表示し、区分別の4レポートには含めない
// (区分ごとの請求額は、デイリーほど意味のある集計にならないため)。
export const SHEET_METRIC_HEADERS_DAILY = [
  "PV数",
  "imp数",
  "imp率",
  "CL数",
  "CL率",
  "友だち追加数",
  "友だち追加率",
  "CV数",
  "CVR",
  "請求額",
] as const;

export const SHEET_METRIC_HEADERS_GROUPED = [
  "PV数",
  "imp数",
  "imp率",
  "CL数",
  "CL率",
  "友だち追加数",
  "友だち追加率",
  "CV数",
  "CVR",
] as const;

const METRIC_FIELDS_DAILY = [
  "pvCount",
  "impCount",
  "impRate",
  "clCount",
  "clRate",
  "friendCount",
  "friendAddRate",
  "cvCount",
  "cvr",
  "billingAmount",
] as const;

const METRIC_FIELDS_GROUPED = [
  "pvCount",
  "impCount",
  "impRate",
  "clCount",
  "clRate",
  "friendCount",
  "friendAddRate",
  "cvCount",
  "cvr",
] as const;

type MetricValue = number | "";
type MetricRow = Record<string, number | null>;

// レポート行から、指標を決まった順番の配列に変換する(null・未インポートは空欄"")
function metricsOf(row: MetricRow, fields: readonly string[]): MetricValue[] {
  return fields.map((f) => {
    const v = row[f];
    return v === null || v === undefined ? "" : v;
  });
}

// 区分(ポップアップ・シナリオ等)が無い日次レポート用の、GAS送信payloadの中身
export type FlatMergeRow = { date: string; values: MetricValue[] };
// 区分がある4レポート用の、GAS送信payloadの中身(区分名ごとに指標の値)
export type GroupedMergeRow = { date: string; values: Record<string, MetricValue[]> };

export type SheetExportReport = {
  sheetName: string;
  metricHeaders: readonly string[];
  // 区分が無い(日次レポート)場合はrows: FlatMergeRow[]、groupsは省略
  // 区分がある場合はrows: GroupedMergeRow[]、groupsにこの期間で登場した区分名一覧(初出順)を入れる
  grouped: boolean;
  groups?: string[];
  rows: FlatMergeRow[] | GroupedMergeRow[];
};

function buildFlatRows(rows: ({ date: string } & MetricRow)[]): FlatMergeRow[] {
  return rows
    .map((r) => ({ date: r.date, values: metricsOf(r, METRIC_FIELDS_DAILY) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function buildGroupedRows<T extends { date: string } & MetricRow>(
  rows: T[],
  groupField: keyof T
): { groups: string[]; rows: GroupedMergeRow[] } {
  const groups: string[] = [];
  const byDate = new Map<string, Record<string, MetricValue[]>>();
  rows.forEach((r) => {
    const g = String(r[groupField]);
    if (!groups.includes(g)) groups.push(g);
    if (!byDate.has(r.date)) byDate.set(r.date, {});
    byDate.get(r.date)![g] = metricsOf(r, METRIC_FIELDS_GROUPED);
  });
  const sortedRows = Array.from(byDate.entries())
    .map(([date, values]) => ({ date, values }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { groups, rows: sortedRows };
}

// 指定した期間(日本時間, YYYY-MM-DD)について、5レポートすべてを計算し、
// それぞれGASのmergeモードにそのまま渡せる形にまとめて返す。
export async function buildSheetExportReports(from: string, to: string): Promise<SheetExportReport[]> {
  const fromMs = new Date(`${from}T00:00:00+09:00`).getTime();
  const toMs = new Date(`${to}T23:59:59.999+09:00`).getTime();
  const dateKeys = enumerateDateKeys(from, to);

  const [
    friends,
    cvEntries,
    dailyAdMetricsByDate,
    popupLabelMap,
    scenarioLabelMap,
    exitPointLabelMap,
    appealLabelMap,
  ] = await Promise.all([
    getReportFriends(fromMs, toMs),
    getReportCvEntries(fromMs, toMs),
    getAdMetricsByDates(dateKeys),
    getPopupLabelMap(),
    getScenarioLabelMap(),
    getExitPointLabelMap(),
    getAppealLabelMap(),
  ]);

  const [popupAdMetrics, scenarioAdMetrics, exitPointAdMetrics, appealAdMetrics] = await Promise.all([
    getPopupAdMetricsInRange(from, to),
    getScenarioAdMetricsInRange(from, to),
    getExitPointAdMetricsInRange(from, to),
    getAppealAdMetricsInRange(from, to),
  ]);

  const dailyRows = buildDailyReport(from, to, friends, cvEntries, dailyAdMetricsByDate);
  const popupRows = buildPopupDailyReport(from, to, friends, cvEntries, popupLabelMap, popupAdMetrics, dailyAdMetricsByDate);
  const scenarioRows = buildScenarioDailyReport(
    from,
    to,
    friends,
    cvEntries,
    scenarioLabelMap,
    scenarioAdMetrics,
    dailyAdMetricsByDate
  );
  const appealRows = buildAppealDailyReport(from, to, friends, cvEntries, appealLabelMap, appealAdMetrics);
  const exitPointRows = buildExitPointDailyReport(
    from,
    to,
    friends,
    cvEntries,
    exitPointLabelMap,
    exitPointAdMetrics,
    dailyAdMetricsByDate
  );

  const popupGrouped = buildGroupedRows(popupRows as never, "popup");
  const scenarioGrouped = buildGroupedRows(scenarioRows as never, "scenario");
  const appealGrouped = buildGroupedRows(appealRows as never, "appeal");
  const exitPointGrouped = buildGroupedRows(exitPointRows as never, "exitPoint");

  return [
    {
      sheetName: "デイリー",
      metricHeaders: SHEET_METRIC_HEADERS_DAILY,
      grouped: false,
      rows: buildFlatRows(dailyRows as never),
    },
    {
      sheetName: "デイリー(p別)",
      metricHeaders: SHEET_METRIC_HEADERS_GROUPED,
      grouped: true,
      groups: popupGrouped.groups,
      rows: popupGrouped.rows,
    },
    {
      sheetName: "デイリー(s別)",
      metricHeaders: SHEET_METRIC_HEADERS_GROUPED,
      grouped: true,
      groups: scenarioGrouped.groups,
      rows: scenarioGrouped.rows,
    },
    {
      sheetName: "デイリー(訴求別)",
      metricHeaders: SHEET_METRIC_HEADERS_GROUPED,
      grouped: true,
      groups: appealGrouped.groups,
      rows: appealGrouped.rows,
    },
    {
      sheetName: "デイリー(離脱地点別)",
      metricHeaders: SHEET_METRIC_HEADERS_GROUPED,
      grouped: true,
      groups: exitPointGrouped.groups,
      rows: exitPointGrouped.rows,
    },
  ];
}
