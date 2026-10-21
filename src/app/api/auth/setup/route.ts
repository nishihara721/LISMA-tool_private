import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { adminDb } from "@/lib/firebase-admin";
import { hashPassword } from "@/lib/password";
import { checkSetupKey } from "@/lib/setup-key";
import { logEvent } from "@/lib/event-log";
import type { AdminUserDoc } from "@/types";

// 初回セットアップ: 管理者アカウントが1つも無いときだけ、最初の管理者アカウントを作成する。
// body: { setupKey, loginId, password, displayName }
// 管理者アカウントが既にある場合は、セットアップキーが正しくても作成しない(以降は「ユーザー管理」画面から作成する)。
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const loginId = typeof body?.loginId === "string" ? body.loginId.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : "";

  const check = await checkSetupKey(body?.setupKey);
  if (!check.ok) {
    return NextResponse.json({ error: check.message }, { status: check.reason === "not_configured" ? 503 : 403 });
  }

  if (!loginId || !password || !displayName) {
    return NextResponse.json({ error: "ログインID・パスワード・表示名はすべて必須です" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "パスワードは8文字以上にしてください" }, { status: 400 });
  }

  const now = Date.now();
  const user: AdminUserDoc = {
    userId: nanoid(8),
    loginId,
    passwordHash: hashPassword(password),
    displayName,
    role: "admin",
    createdAt: now,
    updatedAt: now,
  };

  // 同時に複数のリクエストが来ても、管理者アカウントが2つ作られないようトランザクション内で確認する
  const created = await adminDb.runTransaction(async (tx) => {
    const admins = await tx.get(adminDb.collection("admin_users").where("role", "==", "admin").limit(1));
    if (!admins.empty) return false;
    tx.set(adminDb.collection("admin_users").doc(user.userId), user);
    return true;
  });

  if (!created) {
    return NextResponse.json(
      { error: "管理者アカウントはすでに登録されています。ログインするか、パスワードを忘れた場合は「ID・パスワードを忘れた方」から復旧してください" },
      { status: 409 }
    );
  }

  await logEvent("info", "auth.initial_setup", "初回セットアップで管理者アカウントを作成しました", { loginId });
  return NextResponse.json({ ok: true });
}
