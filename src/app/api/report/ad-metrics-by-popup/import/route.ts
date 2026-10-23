import { NextRequest, NextResponse } from "next/server";
import { invalidateReportCache } from "@/lib/report-cache";
import { adminDb } from "@/lib/firebase-admin";
import type { DailyPopupAdMetricsDoc } from "@/types";

// Flipdesk等からエクスポートしたCSV(シナリオ・日付ごとの行)から、
// 「シナリオ」列(命名規則付きの名前)と「グループ」列(A/B/-)を使ってポップアップ名を抽出し、
// 日付・ポップアップごとに合算してからインポートする(抽出ロジックはsrc/lib/scenario-popup.ts)。
// body側(クライアント)で日付・ポップアップごとの合計値まで計算済みのものを受け取る。
//
// body: { rows: { date: string (YYYY-MM-DD), popup: string, pvCount?: number, impCount?: number, clCount?: number }[] }
//
// 同じ(日付, ポップアップ)を再度取り込んだ場合は、その値をそのまま置き換える(合算はしない)。
// ドキュメントIDは`${date}__${popup}`(popupはドキュメントIDに使えない文字を避けるためencodeURIComponentする)。
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const rows = body?.rows as { date: string; popup: string; pvCount?: number; impCount?: number; clCount?: number }[] | undefined;

  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "rowsは必須です" }, { status: 400 });
  }
  if (rows.some((r) => !/^\d{4}-\d{2}-\d{2}$/.test(r.date ?? ""))) {
    return NextResponse.json({ error: "dateの形式が不正な行があります(YYYY-MM-DD)" }, { status: 400 });
  }
  if (rows.some((r) => !r.popup || !r.popup.trim())) {
    return NextResponse.json({ error: "popup(ポップアップ名)が空の行があります" }, { status: 400 });
  }

  const now = Date.now();
  const chunkSize = 400; // Firestoreの1バッチあたり上限(500)に余裕を持たせる
  for (let i = 0; i < rows.length; i += chunkSize) {
    const batch = adminDb.batch();
    rows.slice(i, i + chunkSize).forEach((r) => {
      const popup = r.popup.trim();
      const entry: Partial<DailyPopupAdMetricsDoc> = {
        date: r.date,
        popup,
        updatedAt: now,
      };
      if (typeof r.pvCount === "number") entry.pvCount = r.pvCount;
      if (typeof r.impCount === "number") entry.impCount = r.impCount;
      if (typeof r.clCount === "number") entry.clCount = r.clCount;
      const docId = `${r.date}__${encodeURIComponent(popup)}`;
      batch.set(adminDb.collection("daily_popup_ad_metrics").doc(docId), entry, { merge: true });
    });
    await batch.commit();
  }

  invalidateReportCache();
  return NextResponse.json({ ok: true, imported: rows.length });
}
