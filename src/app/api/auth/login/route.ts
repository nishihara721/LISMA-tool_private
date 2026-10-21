import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { verifyPassword } from "@/lib/password";
import { ADMIN_SESSION_COOKIE, createSessionToken } from "@/lib/session";
import type { AdminUserDoc } from "@/types";

// 管理画面ログイン。loginId・passwordを照合し、成功したらセッションCookieを発行する。
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const loginId = typeof body?.loginId === "string" ? body.loginId.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!loginId || !password) {
    return NextResponse.json({ error: "ログインIDとパスワードを入力してください" }, { status: 400 });
  }

  const snap = await adminDb.collection("admin_users").where("loginId", "==", loginId).limit(1).get();
  if (snap.empty) {
    return NextResponse.json({ error: "ログインIDまたはパスワードが正しくありません" }, { status: 401 });
  }

  const user = snap.docs[0].data() as AdminUserDoc;
  if (!verifyPassword(password, user.passwordHash)) {
    return NextResponse.json({ error: "ログインIDまたはパスワードが正しくありません" }, { status: 401 });
  }

  const token = await createSessionToken({
    userId: user.userId,
    loginId: user.loginId,
    displayName: user.displayName,
    role: user.role,
    allowedPages: user.role === "report_viewer" ? user.allowedPages ?? [] : null,
  });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30日間
  });
  return res;
}
