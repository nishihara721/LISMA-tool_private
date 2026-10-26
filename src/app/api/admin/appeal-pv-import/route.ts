import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/require-admin";
import { applyAppealPvImport, listAdMetricsImports, validateAppealPvRows, type AppealPvRow } from "@/lib/ad-metrics-batch";

export const dynamic = "force-dynamic";

// GET: 訴求別PV数の取り込み履歴(新しい順)
export async function GET() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  return NextResponse.json(await listAdMetricsImports("appeal_pv"));
}

// POST: 訴求別PV数の取り込み。取り込み前のPV数を控えるため、あとから取り消せる。
// body: { fileName?: string, rows: { date: string (YYYY-MM-DD), appeal: string, pvCount: number }[] }
// 同じ(日付, 訴求)を再度取り込んだ場合は、値を置き換える(合算はしない)。
export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const error = validateAppealPvRows(body?.rows);
  if (error) return NextResponse.json({ error }, { status: 400 });
  const record = await applyAppealPvImport(body.rows as AppealPvRow[], {
    fileName: typeof body.fileName === "string" ? body.fileName.slice(0, 200) : "",
    createdBy: session.loginId,
  });
  return NextResponse.json({ ok: true, record });
}
