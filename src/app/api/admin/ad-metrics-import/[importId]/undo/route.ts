import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/require-admin";
import { undoAdMetricsImport } from "@/lib/ad-metrics-batch";

export const dynamic = "force-dynamic";

// imp数・CL数の取り込みを取り消す(取り込み前の値に戻す)。取り消せるのは、取り消していない取り込みのうち一番新しい1件だけ。
export async function POST(_req: Request, { params }: { params: Promise<{ importId: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  const { importId } = await params;
  const result = await undoAdMetricsImport(importId, session.loginId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, restored: result.restored });
}
