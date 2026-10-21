import { invalidateSettingsCache } from "@/lib/settings-cache";
import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { buildPurchaseLinkName, type PurchaseLinkNameParts } from "@/lib/purchase-link-name";

// body: { scenario?, messageCount?, other?, unitPrice?, destinationUrl: string, liffId: string }
// nameは構成要素(scenario/messageCount/other)から自動生成するため、クライアントからは受け取らない。
export async function PUT(req: NextRequest, { params }: { params: Promise<{ purchaseLinkId: string }> }) {
  const { purchaseLinkId } = await params;
  const body = (await req.json()) as PurchaseLinkNameParts & { destinationUrl: string; liffId: string; unitPrice?: number | null };
  const name = buildPurchaseLinkName(body);
  if (!name) {
    return NextResponse.json({ error: "いずれかの項目を入力してください" }, { status: 400 });
  }
  if (!body.destinationUrl || !body.liffId) {
    return NextResponse.json({ error: "destinationUrl・liffIdは必須です" }, { status: 400 });
  }

  if (body.unitPrice !== undefined && body.unitPrice !== null && (typeof body.unitPrice !== "number" || Number.isNaN(body.unitPrice) || body.unitPrice < 0)) {
    return NextResponse.json({ error: "成果単価は0以上の数値で入力してください" }, { status: 400 });
  }

  const ref = adminDb.collection("purchase_links").doc(purchaseLinkId);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "指定された広告が見つかりません" }, { status: 404 });
  }

  // 各構成要素は、空欄で送られてきた場合はフィールドごと削除する(「未入力」状態に戻すため)。
  await ref.update({
    name,
    scenario: body.scenario?.trim() || FieldValue.delete(),
    messageCount:
      typeof body.messageCount === "number" && !Number.isNaN(body.messageCount)
        ? body.messageCount
        : FieldValue.delete(),
    other: body.other?.trim() || FieldValue.delete(),
    unitPrice: typeof body.unitPrice === "number" ? body.unitPrice : FieldValue.delete(),
    destinationUrl: body.destinationUrl,
    liffId: body.liffId,
  });
  invalidateSettingsCache();
  return NextResponse.json({ ok: true });
}

// 登録済みのクリックログ・成果ログは削除しない(過去の計測データを壊さないため)。
// マスタ(名前の表示・リンク発行に使う)だけを削除する。
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ purchaseLinkId: string }> }) {
  const { purchaseLinkId } = await params;
  await adminDb.collection("purchase_links").doc(purchaseLinkId).delete();
  invalidateSettingsCache();
  return NextResponse.json({ ok: true });
}
