import { NextRequest, NextResponse } from "next/server";
import { invalidateReportCache } from "@/lib/report-cache";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { MEMO_MAX_LENGTH } from "@/lib/memo-links";

// 日次レポート画面上でのPV数・imp数・CL数の手動編集(1日分)。
// CSV/Excel取り込みでは埋まらないPV数の入力、および取り込んだimp数・CL数の修正に使う。
//
// body: { pvCount?: number | null, impCount?: number | null, clCount?: number | null, memo?: string | null }
// 値がnumberならその値を設定し、nullなら該当フィールドを削除(未入力状態に戻す)する。
// キー自体を省略したフィールドには触れない。
export async function PUT(req: NextRequest, { params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "dateの形式が不正です(YYYY-MM-DD)" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "リクエスト内容が不正です" }, { status: 400 });
  }

  const fields: Record<string, "pvCount" | "impCount" | "clCount"> = {
    pvCount: "pvCount",
    impCount: "impCount",
    clCount: "clCount",
  };

  const update: Record<string, number | string | FieldValue> = { updatedAt: Date.now() };
  for (const key of Object.keys(fields)) {
    if (!(key in body)) continue; // キーが無いフィールドは触れない
    const value = body[key];
    if (value === null) {
      update[key] = FieldValue.delete();
    } else if (typeof value === "number" && !Number.isNaN(value)) {
      update[key] = value;
    } else {
      return NextResponse.json({ error: `${key}の値が不正です(数値またはnull)` }, { status: 400 });
    }
  }

  // メモ欄(文字列。空文字またはnullなら削除)
  if ("memo" in body) {
    const memo = body.memo;
    if (memo === null || (typeof memo === "string" && memo.trim() === "")) {
      update.memo = FieldValue.delete();
    } else if (typeof memo === "string" && memo.length <= MEMO_MAX_LENGTH) {
      update.memo = memo;
    } else {
      return NextResponse.json({ error: `memoは${MEMO_MAX_LENGTH}文字以内の文字列で指定してください` }, { status: 400 });
    }
  }

  await adminDb.collection("daily_ad_metrics").doc(date).set({ date, ...update }, { merge: true });

  invalidateReportCache();
  return NextResponse.json({ ok: true });
}
