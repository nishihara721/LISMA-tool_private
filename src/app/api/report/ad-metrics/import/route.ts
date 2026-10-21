import { NextRequest, NextResponse } from "next/server";
import { invalidateReportCache } from "@/lib/report-cache";
import { adminDb } from "@/lib/firebase-admin";
import type { DailyAdMetricsDoc } from "@/types";

// Flipdesk等からエクスポートしたCSV(シナリオ・日付ごとの行)、またはPV数集計ツールからエクスポートした
// CSV(日付ごとの行)を、日付ごとに合算してからインポートする。
// body側(クライアント)で日付ごとの合計値まで計算済みのものを受け取る。
//
// body: { rows: { date: string (YYYY-MM-DD), pvCount?: number, impCount?: number, clCount?: number }[] }
//
// imp数・CL数のインポート(「imp数・CL数の取り込み」画面)とPV数のインポート(「PV数の取り込み」画面)は
// それぞれ別の取り込み口だが、どちらもこのエンドポイントを共有している。merge:trueにより、
// 一方のインポートでもう一方が設定したフィールドを消さないようにしている。
//
// 同じ期間を再インポートした場合は、その日付の値をそのまま置き換える(合算はしない)。
// 元データのエクスポートが指定期間を毎回フルに含む形式のため、再取り込み=最新値への更新という扱いにしている。
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const rows = body?.rows as { date: string; pvCount?: number; impCount?: number; clCount?: number }[] | undefined;

  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "rowsは必須です" }, { status: 400 });
  }
  if (rows.some((r) => !/^\d{4}-\d{2}-\d{2}$/.test(r.date ?? ""))) {
    return NextResponse.json({ error: "dateの形式が不正な行があります(YYYY-MM-DD)" }, { status: 400 });
  }

  const now = Date.now();
  const batch = adminDb.batch();
  rows.forEach((r) => {
    const entry: Partial<DailyAdMetricsDoc> = {
      date: r.date,
      updatedAt: now,
    };
    if (typeof r.pvCount === "number") entry.pvCount = r.pvCount;
    if (typeof r.impCount === "number") entry.impCount = r.impCount;
    if (typeof r.clCount === "number") entry.clCount = r.clCount;
    batch.set(adminDb.collection("daily_ad_metrics").doc(r.date), entry, { merge: true });
  });
  await batch.commit();

  invalidateReportCache();
  return NextResponse.json({ ok: true, imported: rows.length });
}
