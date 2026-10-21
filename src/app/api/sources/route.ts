import { invalidateSettingsCache } from "@/lib/settings-cache";
import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { adminDb } from "@/lib/firebase-admin";
import { buildSourceName, type SourceNameParts } from "@/lib/source-name";
import type { SourceDoc } from "@/types";

// 画面を開くたびに最新の一覧を返す(ビルド時の内容を使い回さない)
export const dynamic = "force-dynamic";

export async function GET() {
  const snap = await adminDb.collection("sources").orderBy("createdAt", "desc").get();
  const sources = snap.docs.map((d) => d.data() as SourceDoc);
  return NextResponse.json({ sources });
}

// body: { placement?, appeal?, popup?, scenario?, exitPoint?, intermediatePage?, other?, lstepUrl? }
// nameは構成要素から自動生成するため、クライアントからは受け取らない。
export async function POST(req: NextRequest) {
  const body = (await req.json()) as SourceNameParts & { lstepUrl?: string };
  const name = buildSourceName(body);
  if (!name) {
    return NextResponse.json({ error: "いずれかの項目を入力してください" }, { status: 400 });
  }

  const source: SourceDoc = {
    sourceId: nanoid(8),
    name,
    placement: body.placement?.trim() || undefined,
    appeal: body.appeal?.trim() || undefined,
    popup: body.popup?.trim() || undefined,
    scenario: body.scenario?.trim() || undefined,
    exitPoint: body.exitPoint?.trim() || undefined,
    intermediatePage: body.intermediatePage?.trim() || undefined,
    other: body.other?.trim() || undefined,
    lstepUrl: body.lstepUrl || undefined,
    createdAt: Date.now(),
  };
  await adminDb.collection("sources").doc(source.sourceId).set(source);
  invalidateSettingsCache();

  return NextResponse.json({ ok: true, source });
}
