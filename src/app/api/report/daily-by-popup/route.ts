import { NextRequest, NextResponse } from "next/server";
import { cachedReportRoute } from "@/lib/report-cache";
import {
  buildPopupDailyReport,
  enumerateDateKeys,
  getActivePopupLabels,
  getAdMetricsByDates,
  getReportCvEntries,
  getReportFriends,
  getPopupAdMetricsInRange,
  getPopupLabelMap,
} from "@/lib/report-cv";

// ポップアップ別日次レポート: 指定した日付範囲(日本時間)について、
// ポップアップ別・日別の友だち追加数・成果数・成果率を返す。
// 成果数は、編集用成果ログ画面で「非表示」にしたものを除いた実効件数(通常の日次レポートと同じ)。
//
// クエリ: /api/report/daily-by-popup?from=YYYY-MM-DD&to=YYYY-MM-DD
async function compute(req: NextRequest) {
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  if (!from || !to) {
    return NextResponse.json({ error: "from・toは必須です(YYYY-MM-DD)" }, { status: 400 });
  }

  const fromMs = new Date(`${from}T00:00:00+09:00`).getTime();
  const toMs = new Date(`${to}T23:59:59.999+09:00`).getTime();
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || fromMs > toMs) {
    return NextResponse.json({ error: "日付の指定が不正です" }, { status: 400 });
  }

  const [friends, cvEntries, popupLabelMap, adMetrics, dailyAdMetricsByDate] = await Promise.all([
    getReportFriends(fromMs, toMs),
    getReportCvEntries(fromMs, toMs),
    getPopupLabelMap(),
    getPopupAdMetricsInRange(from, to),
    getAdMetricsByDates(enumerateDateKeys(from, to)),
  ]);

  const rows = buildPopupDailyReport(from, to, friends, cvEntries, popupLabelMap, adMetrics, dailyAdMetricsByDate);
  const activeLabels = Array.from(await getActivePopupLabels(popupLabelMap));

  return NextResponse.json({ rows, activeLabels });
}

// 同じ期間のレポートは短時間キャッシュして返す(取り込み・編集の直後は即時に破棄される。src/lib/report-cache.ts)
export async function GET(req: NextRequest) {
  return cachedReportRoute(req, compute);
}
