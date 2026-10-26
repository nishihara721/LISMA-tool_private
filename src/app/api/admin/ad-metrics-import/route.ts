import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/require-admin";
import { applyAdMetricsImport, listAdMetricsImports, validatePayload, type AdMetricsImportPayload } from "@/lib/ad-metrics-batch";

export const dynamic = "force-dynamic";

// GET: imp数・CL数の取り込み履歴(新しい順)。latestActiveIdは、いま取り消せる取り込み(取り消していない中で一番新しいもの)
export async function GET() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  return NextResponse.json(await listAdMetricsImports());
}

// POST: imp数・CL数の取り込み(日次・ポップアップ別・シナリオ別・離脱地点別・訴求別・流入経路別・ポップアップ×シナリオ別を1回でまとめて)。
// 取り込み前の値を控えるため、あとから取り消せる。
// body: { fileName?: string } & AdMetricsImportPayload
export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const error = validatePayload(body);
  if (error) return NextResponse.json({ error }, { status: 400 });
  const record = await applyAdMetricsImport(body as AdMetricsImportPayload, {
    fileName: typeof body.fileName === "string" ? body.fileName.slice(0, 200) : "",
    createdBy: session.loginId,
  });
  return NextResponse.json({ ok: true, record });
}
