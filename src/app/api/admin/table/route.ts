import { NextRequest, NextResponse } from "next/server";
import { TABLE_KINDS, queryTable, type FilterValue, type TableKind } from "@/lib/log-tables";
import { logEvent } from "@/lib/event-log";
import { ADMIN_SESSION_COOKIE, canAccessPage, verifySessionToken } from "@/lib/session";

export const dynamic = "force-dynamic";

// 友だち一覧・各ログ画面のページネーション用API。
// body: { kind, cursor?, pageSize?, filters? }  (詳細は src/lib/log-tables.ts)
// 閲覧のみの処理だが、絞り込み条件を渡すためPOSTにしている(管理者のほか、許可されたレポート閲覧権限のユーザーも広告クリックログ・広告成果ログに限り呼び出せる)。
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const kind = body?.kind as TableKind | undefined;
  if (!kind || !TABLE_KINDS.includes(kind)) {
    return NextResponse.json({ error: "kindが不正です" }, { status: 400 });
  }

  // 管理者以外(レポート閲覧権限)は、許可された広告クリックログ・広告成果ログのみ取得でき、友だち名は返さない。
  // (ミドルウェアはPOSTを通すため、権限チェックはここで必ず行う)
  const session = await verifySessionToken(req.cookies.get(ADMIN_SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  const isAdmin = session.role === "admin";
  if (!isAdmin) {
    const pageByKind: Partial<Record<TableKind, string>> = {
      purchase_clicks: "/admin/logs/clicks",
      conversions: "/admin/logs/conversions",
    };
    const page = pageByKind[kind];
    if (!page || !canAccessPage(session, page)) {
      return NextResponse.json({ error: "閲覧権限がありません" }, { status: 403 });
    }
  }
  const pageSize = Math.min(Math.max(Number(body?.pageSize) || 50, 1), 500);
  const cursor = typeof body?.cursor === "string" ? body.cursor : null;

  const filters: Record<string, FilterValue> = {};
  const rawFilters = body?.filters && typeof body.filters === "object" ? body.filters : {};
  for (const [key, v] of Object.entries(rawFilters as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const f = v as Record<string, unknown>;
    filters[key] = {
      text: typeof f.text === "string" ? f.text.slice(0, 200) : undefined,
      values: Array.isArray(f.values) ? f.values.filter((x): x is string => typeof x === "string").slice(0, 100) : undefined,
      from: typeof f.from === "string" ? f.from : undefined,
      to: typeof f.to === "string" ? f.to : undefined,
    };
  }

  try {
    const result = await queryTable({ kind, cursor, pageSize, filters, hideFriendName: !isAdmin });
    return NextResponse.json(result);
  } catch (e) {
    await logEvent("error", "admin_table.query_failed", "一覧の取得に失敗しました", { kind, error: String(e) });
    return NextResponse.json({ error: "一覧の取得に失敗しました" }, { status: 500 });
  }
}
