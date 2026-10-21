import { NextRequest, NextResponse } from "next/server";
import { cachedReportRoute } from "@/lib/report-cache";
import { buildDailyReport, enumerateDateKeys, getAdMetricsByDates, getReportCvEntries, getReportFriends } from "@/lib/report-cv";

// 日次レポート: 指定した日付範囲(日本時間)について、日ごとの友だち追加数・成果数・成果率を返す。
// 成果数は、編集用成果ログ画面で「非表示」にしたものを除いた実効件数。
//
// クエリ: /api/report/daily?from=YYYY-MM-DD&to=YYYY-MM-DD
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

  const [friends, cvEntries, adMetricsByDate] = await Promise.all([
    getReportFriends(fromMs, toMs),
    getReportCvEntries(fromMs, toMs),
    getAdMetricsByDates(enumerateDateKeys(from, to)),
  ]);

  const rows = buildDailyReport(from, to, friends, cvEntries, adMetricsByDate);

  return NextResponse.json({ rows });
}

// 同じ期間のレポートは短時間キャッシュして返す(取り込み・編集の直後は即時に破棄される。src/lib/report-cache.ts)
export async function GET(req: NextRequest) {
  return cachedReportRoute(req, compute);
}
