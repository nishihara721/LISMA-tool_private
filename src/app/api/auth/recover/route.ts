import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { hashPassword } from "@/lib/password";
import { checkSetupKey } from "@/lib/setup-key";
import { logEvent } from "@/lib/event-log";
import type { AdminUserDoc } from "@/types";

// ID・パスワードを忘れた場合の復旧。セットアップキーで本人(サーバーの管理者)確認をした上で、
//   action: "list"  → 登録済みアカウントのログインID・表示名・権限の一覧を返す(IDを忘れた場合に確認する)
//   action: "reset" → 指定したログインIDのパスワードを新しいものに再設定する(body: { loginId, newPassword })
// body には毎回 setupKey が必要。
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  const check = await checkSetupKey(body?.setupKey);
  if (!check.ok) {
    return NextResponse.json({ error: check.message }, { status: check.reason === "not_configured" ? 503 : 403 });
  }

  if (body?.action === "list") {
    const snap = await adminDb.collection("admin_users").orderBy("createdAt", "asc").get();
    const users = snap.docs.map((d) => {
      const u = d.data() as AdminUserDoc;
      return { loginId: u.loginId, displayName: u.displayName, role: u.role };
    });
    await logEvent("info", "auth.recover_list", "ID・パスワード復旧画面でアカウント一覧を表示しました");
    return NextResponse.json({ users });
  }

  if (body?.action === "reset") {
    const loginId = typeof body?.loginId === "string" ? body.loginId.trim() : "";
    const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";
    if (!loginId || !newPassword) {
      return NextResponse.json({ error: "ログインIDと新しいパスワードを入力してください" }, { status: 400 });
    }
    if (newPassword.length < 8) {
      return NextResponse.json({ error: "パスワードは8文字以上にしてください" }, { status: 400 });
    }
    const snap = await adminDb.collection("admin_users").where("loginId", "==", loginId).limit(1).get();
    if (snap.empty) {
      return NextResponse.json({ error: "そのログインIDのアカウントは見つかりません" }, { status: 404 });
    }
    await snap.docs[0].ref.set({ passwordHash: hashPassword(newPassword), updatedAt: Date.now() }, { merge: true });
    await logEvent("info", "auth.password_reset", "復旧画面からパスワードを再設定しました", { loginId });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "不正なリクエストです" }, { status: 400 });
}
