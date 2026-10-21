import { NextRequest, NextResponse } from "next/server";
import { invalidateReportCache } from "@/lib/report-cache";
import { adminDb } from "@/lib/firebase-admin";
import type { DailyExitPointAdMetricsDoc } from "@/types";

// ad-metrics-by-popup/import・ad-metrics-by-scenario/import と同じ構成で、
// 集計軸を「離脱地点」に置き換えたもの。
// body: { rows: { date: string (YYYY-MM-DD), exitPoint: string, pvCount?: number, impCount?: number, clCount?: number }[] }
// 同じ(日付, 離脱地点)を再度取り込んだ場合は、その値をそのまま置き換える(合算はしない)。
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const rows = body?.rows as { date: string; exitPoint: string; pvCount?: number; impCount?: number; clCount?: number }[] | undefined;

  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "rowsは必須です" }, { status: 400 });
  }
  if (rows.some((r) => !/^\d{4}-\d{2}-\d{2}$/.test(r.date ?? ""))) {
    return NextResponse.json({ error: "dateの形式が不正な行があります(YYYY-MM-DD)" }, { status: 400 });
  }
  if (rows.some((r) => !r.exitPoint || !r.exitPoint.trim())) {
    return NextResponse.json({ error: "exitPoint(離脱地点名)が空の行があります" }, { status: 400 });
  }

  const now = Date.now();
  const chunkSize = 400; // Firestoreの1バッチあたり上限(500)に余裕を持たせる
  for (let i = 0; i < rows.length; i += chunkSize) {
    const batch = adminDb.batch();
    rows.slice(i, i + chunkSize).forEach((r) => {
      const exitPoint = r.exitPoint.trim();
      const entry: Partial<DailyExitPointAdMetricsDoc> = {
        date: r.date,
        exitPoint,
        updatedAt: now,
      };
      if (typeof r.pvCount === "number") entry.pvCount = r.pvCount;
      if (typeof r.impCount === "number") entry.impCount = r.impCount;
      if (typeof r.clCount === "number") entry.clCount = r.clCount;
      const docId = `${r.date}__${encodeURIComponent(exitPoint)}`;
      batch.set(adminDb.collection("daily_exit_point_ad_metrics").doc(docId), entry, { merge: true });
    });
    await batch.commit();
  }

  invalidateReportCache();
  return NextResponse.json({ ok: true, imported: rows.length });
}
