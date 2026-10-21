import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { isSetupKeyConfigured } from "@/lib/setup-key";

// ログイン画面の「初回セットアップ」「ID・パスワードを忘れた場合」の案内表示用。
// セットアップキーが設定されているか、管理者アカウントがすでにあるかだけを返す(それ以外の情報は返さない)。
// 画面を開くたびに最新の一覧を返す(ビルド時の内容を使い回さない)
export const dynamic = "force-dynamic";

export async function GET() {
  const admins = await adminDb.collection("admin_users").where("role", "==", "admin").limit(1).get();
  return NextResponse.json({ configured: isSetupKeyConfigured(), hasAdmin: !admins.empty });
}
