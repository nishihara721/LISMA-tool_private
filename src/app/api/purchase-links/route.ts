import { invalidateSettingsCache } from "@/lib/settings-cache";
import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { adminDb } from "@/lib/firebase-admin";
import { buildPurchaseLinkName, type PurchaseLinkNameParts } from "@/lib/purchase-link-name";
import type { PurchaseLinkDoc } from "@/types";

// 画面を開くたびに最新の一覧を返す(ビルド時の内容を使い回さない)
export const dynamic = "force-dynamic";

export async function GET() {
  const snap = await adminDb.collection("purchase_links").orderBy("createdAt", "desc").get();
  const purchaseLinks = snap.docs.map((d) => d.data() as PurchaseLinkDoc);
  return NextResponse.json({ purchaseLinks });
}

// body: { scenario?, messageCount?, other?, unitPrice?, destinationUrl: string, liffId: string }
// unitPrice: 成果単価(円。0以上の数値)
// liffId: destinationUrlのページを「エンドポイントURL」として登録したLIFFアプリのID
// nameは構成要素(scenario/messageCount/other)から自動生成するため、クライアントからは受け取らない。
export async function POST(req: NextRequest) {
  const body = (await req.json()) as PurchaseLinkNameParts & { destinationUrl: string; liffId: string; unitPrice?: number };
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

  const purchaseLink: PurchaseLinkDoc = {
    purchaseLinkId: nanoid(8),
    name,
    scenario: body.scenario?.trim() || undefined,
    messageCount: typeof body.messageCount === "number" && !Number.isNaN(body.messageCount) ? body.messageCount : undefined,
    other: body.other?.trim() || undefined,
    unitPrice: typeof body.unitPrice === "number" ? body.unitPrice : undefined,
    destinationUrl: body.destinationUrl,
    liffId: body.liffId,
    createdAt: Date.now(),
  };
  await adminDb.collection("purchase_links").doc(purchaseLink.purchaseLinkId).set(purchaseLink);
  invalidateSettingsCache();

  return NextResponse.json({ ok: true, purchaseLink });
}
