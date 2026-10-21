import { NextRequest, NextResponse } from "next/server";
import { cachedReportRoute } from "@/lib/report-cache";
import {
  buildDailyReport,
  enumerateDateKeys,
  getAdMetricsByDates,
  getReportCvEntries,
  getReportFriends,
} from "@/lib/report-cv";
import { buildMonthlyReport, monthRangeToDateKeys } from "@/lib/report-monthly";

// 合算の月次レポート: 指定した月範囲(日本時間)について、月ごとの
// PV数・imp数・imp率・CL数・CL率・友だち追加数・友だち追加率・CV数・CVRを返す(閲覧専用)。
//
// クエリ: /api/report/monthly?fromMonth=YYYY-MM&toMonth=YYYY-MM
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

  const [friends, cvEntries, adMetricsByDate] = await Promise.all([
    getReportFriends(fromMs, toMs),
    getReportCvEntries(fromMs, toMs),
    getAdMetricsByDates(enumerateDateKeys(fromDateKey, toDateKey)),
  ]);

  const dailyRows = buildDailyReport(fromDateKey, toDateKey, friends, cvEntries, adMetricsByDate);
  const rows = buildMonthlyReport(dailyRows, fromMonth, toMonth);

  return NextResponse.json({ rows });
}

// 同じ期間のレポートは短時間キャッシュして返す(取り込み・編集の直後は即時に破棄される。src/lib/report-cache.ts)
export async function GET(req: NextRequest) {
  return cachedReportRoute(req, compute);
}
