import { NextRequest, NextResponse } from "next/server";
import { cachedReportRoute } from "@/lib/report-cache";
import {
  buildDailyReport,
  buildPopupDailyReport,
  enumerateDateKeys,
  getAdMetricsByDates,
  getReportCvEntries,
  getReportFriends,
  getPopupAdMetricsInRange,
  getPopupLabelMap,
  getPopupScenarioAdMetricsInRange,
  getPopupScenarioLabelMap,
  getSourceAdMetricsInRange,
  getSourceNameLabelMap,
} from "@/lib/report-cv";
import { buildMonthlyReport, buildPopupMonthlyReport, monthRangeToDateKeys } from "@/lib/report-monthly";
import type { DailyPopupAdMetricsDoc } from "@/types";

// 月次サマリ: ポップアップ別・ポップアップ×シナリオ別・設置先×訴求×離脱地点×ポップアップ×シナリオ×中間別の
// 3つの月次集計を、1回の問い合わせでまとめて返す(閲覧専用)。
// 友だち追加・成果・日次の合計PV数・流入経路/広告の設定は3つの集計で共通のため、1回だけ読み込んで使い回している
// (3つのAPIを別々に呼ぶ場合に比べ、Firestoreの読み取りを約1/3にできる)。
//
// クエリ: /api/report/monthly-summary?fromMonth=YYYY-MM&toMonth=YYYY-MM
async function compute(req: NextRequest) {
  const fromMonth = req.nextUrl.searchParams.get("fromMonth");
  const toMonth = req.nextUrl.searchParams.get("toMonth");
  if (!fromMonth || !toMonth || !/^\d{4}-\d{2}$/.test(fromMonth) || !/^\d{4}-\d{2}$/.test(toMonth)) {
    return NextResponse.json({ error: "fromMonth・toMonthは必須です(YYYY-MM)" }, { status: 400 });
  }
  if (fromMonth > toMonth) {
    return NextResponse.json({ error: "期間の指定が不正です" }, { status: 400 });
  }

  const { fromDateKey, toDateKey } = monthRangeToDateKeys(fromMonth, toMonth);
  const fromMs = new Date(`${fromDateKey}T00:00:00+09:00`).getTime();
  const toMs = new Date(`${toDateKey}T23:59:59.999+09:00`).getTime();

  const [
    friends,
    cvEntries,
    dailyAdMetricsByDate,
    popupLabels,
    popupScenarioLabels,
    sourceLabels,
    popupMetrics,
    popupScenarioMetrics,
    sourceMetrics,
  ] = await Promise.all([
    getReportFriends(fromMs, toMs),
    getReportCvEntries(fromMs, toMs),
    getAdMetricsByDates(enumerateDateKeys(fromDateKey, toDateKey)),
    getPopupLabelMap(),
    getPopupScenarioLabelMap(),
    getSourceNameLabelMap(),
    getPopupAdMetricsInRange(fromDateKey, toDateKey),
    getPopupScenarioAdMetricsInRange(fromDateKey, toDateKey),
    getSourceAdMetricsInRange(fromDateKey, toDateKey),
  ]);

  // ポップアップ別の集計ロジックを流用するため、ラベルをpopupフィールドに載せ替える
  const asPopupMetrics = <T extends { date: string; impCount?: number; clCount?: number; updatedAt: number }>(
    src: Map<string, T>,
    labelOf: (m: T) => string
  ) => {
    const out = new Map<string, DailyPopupAdMetricsDoc>();
    src.forEach((m, key) => {
      out.set(key, { date: m.date, popup: labelOf(m), impCount: m.impCount, clCount: m.clCount, updatedAt: m.updatedAt });
    });
    return out;
  };

  const build = (labelMap: Map<string, string>, metrics: Map<string, DailyPopupAdMetricsDoc>) =>
    buildPopupMonthlyReport(
      buildPopupDailyReport(fromDateKey, toDateKey, friends, cvEntries, labelMap, metrics, dailyAdMetricsByDate),
      fromMonth,
      toMonth
    ).map(({ popup, ...rest }) => ({ ...rest, label: popup }));

  // 表示期間の月別合計(ポップアップ等で分けない全体の月ごとの値)。上で読み込み済みのデータをそのまま使うため、追加の読み取りはない
  const monthly = buildMonthlyReport(
    buildDailyReport(fromDateKey, toDateKey, friends, cvEntries, dailyAdMetricsByDate),
    fromMonth,
    toMonth
  );

  return NextResponse.json({
    monthly,
    popup: build(popupLabels, popupMetrics),
    "popup-scenario": build(
      popupScenarioLabels,
      asPopupMetrics(popupScenarioMetrics, (m) => m.label)
    ),
    source: build(
      sourceLabels,
      asPopupMetrics(sourceMetrics, (m) => m.sourceName)
    ),
  });
}

// 同じ期間のレポートは短時間キャッシュして返す(取り込み・編集の直後は即時に破棄される。src/lib/report-cache.ts)
export async function GET(req: NextRequest) {
  return cachedReportRoute(req, compute);
}
