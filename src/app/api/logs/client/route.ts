import { NextRequest, NextResponse } from "next/server";
import { logEvent } from "@/lib/event-log";
import type { LogLevel } from "@/types";

// クライアント側(/liff/add のJS、購入LP/サンクスページに設置するtrack.js)から、
// 通信エラーやLIFF初期化失敗など「サーバーには届かないタイプの不具合」を報告するための窓口。
// track.jsは自社ドメイン外のLP上で動くため、クロスオリジンでの呼び出しを許可する必要がある。
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}

// body: { stage: string, message: string, level?: "info"|"warn"|"error", context?: object }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || !body.stage || !body.message) {
    return NextResponse.json({ error: "stage・messageは必須です" }, { status: 400, headers: CORS_HEADERS });
  }

  const level: LogLevel = body.level === "info" || body.level === "error" ? body.level : "warn";
  await logEvent(level, String(body.stage), String(body.message), body.context);

  return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
}
