import { NextRequest, NextResponse } from "next/server";
import { invalidateReportCache } from "@/lib/report-cache";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";

// ad-metrics-by-popup/[date]と同じ構成で、集計軸を「訴求」に置き換えたもの。
//
// body: { appeal: string, pvCount: number | null }
export async function PUT(req: NextRequest, { params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "dateの形式が不正です(YYYY-MM-DD)" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.appeal !== "string" || !body.appeal.trim()) {
    return NextResponse.json({ error: "appeal(訴求名)は必須です" }, { status: 400 });
  }

  const appeal = body.appeal.trim();
  const pvCount = body.pvCount;
  let pvUpdate: number | FieldValue;
  if (pvCount === null) {
    pvUpdate = FieldValue.delete();
  } else if (typeof pvCount === "number" && !Number.isNaN(pvCount)) {
    pvUpdate = pvCount;
  } else {
    return NextResponse.json({ error: "pvCountの値が不正です(数値またはnull)" }, { status: 400 });
  }

  const docId = `${date}__${encodeURIComponent(appeal)}`;
  await adminDb
    .collection("daily_appeal_ad_metrics")
    .doc(docId)
    .set({ date, appeal, pvCount: pvUpdate, updatedAt: Date.now() }, { merge: true });

  invalidateReportCache();
  return NextResponse.json({ ok: true });
}
