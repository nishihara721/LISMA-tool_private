import { invalidateSettingsCache } from "@/lib/settings-cache";
import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { buildSourceName, type SourceNameParts } from "@/lib/source-name";

// body: { placement?, appeal?, popup?, scenario?, exitPoint?, intermediatePage?, other?, lstepUrl? }
// nameは構成要素から自動生成するため、クライアントからは受け取らない。
export async function PUT(req: NextRequest, { params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await params;
  const body = (await req.json()) as SourceNameParts & { lstepUrl?: string };
  const name = buildSourceName(body);
  if (!name) {
    return NextResponse.json({ error: "いずれかの項目を入力してください" }, { status: 400 });
  }

  const ref = adminDb.collection("sources").doc(sourceId);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "指定された流入経路が見つかりません" }, { status: 404 });
  }

  // 各構成要素は、空欄で送られてきた場合はフィールドごと削除する(「未入力」状態に戻すため)。
  // lstepUrlも同様に、空文字で送られてきた場合は「設定解除」とみなしてフィールドごと削除する。
  // messageCount(通数)は流入経路には存在しない項目のため、誤って登録されていた場合に備えて常に削除する。
  await ref.update({
    name,
    placement: body.placement?.trim() || FieldValue.delete(),
    appeal: body.appeal?.trim() || FieldValue.delete(),
    popup: body.popup?.trim() || FieldValue.delete(),
    scenario: body.scenario?.trim() || FieldValue.delete(),
    exitPoint: body.exitPoint?.trim() || FieldValue.delete(),
    intermediatePage: body.intermediatePage?.trim() || FieldValue.delete(),
    messageCount: FieldValue.delete(),
    other: body.other?.trim() || FieldValue.delete(),
    lstepUrl: body.lstepUrl ? body.lstepUrl : FieldValue.delete(),
  });
  invalidateSettingsCache();
  return NextResponse.json({ ok: true });
}

// 登録済みのクリックログ・友だちデータは削除しない(過去の計測データを壊さないため)。
// マスタ(名前の表示に使う)だけを削除する。
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await params;
  await adminDb.collection("sources").doc(sourceId).delete();
  invalidateSettingsCache();
  return NextResponse.json({ ok: true });
}
