import { NextRequest, NextResponse } from "next/server";
import { invalidateReportCache } from "@/lib/report-cache";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";

// ポップアップ別日次レポート画面上での、特定の(日付, ポップアップ)のPV数の手動編集。
// /api/report/ad-metrics/[date] (通常の日次レポート用)と同じ考え方で、
// 集計軸が「ポップアップ」単位になったもの。
//
// body: { popup: string, pvCount: number | null }
// pvCountがnumberならその値を設定し、nullならフィールドを削除(未入力状態に戻す)する。
export async function PUT(req: NextRequest, { params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "dateの形式が不正です(YYYY-MM-DD)" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.popup !== "string" || !body.popup.trim()) {
    return NextResponse.json({ error: "popup(ポップアップ名)は必須です" }, { status: 400 });
  }

  const popup = body.popup.trim();
  const pvCount = body.pvCount;
  let pvUpdate: number | FieldValue;
  if (pvCount === null) {
    pvUpdate = FieldValue.delete();
  } else if (typeof pvCount === "number" && !Number.isNaN(pvCount)) {
    pvUpdate = pvCount;
  } else {
    return NextResponse.json({ error: "pvCountの値が不正です(数値またはnull)" }, { status: 400 });
  }

  const docId = `${date}__${encodeURIComponent(popup)}`;
  await adminDb
    .collection("daily_popup_ad_metrics")
    .doc(docId)
    .set({ date, popup, pvCount: pvUpdate, updatedAt: Date.now() }, { merge: true });

  invalidateReportCache();
  return NextResponse.json({ ok: true });
}
