import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE, verifySessionToken, type SessionPayload } from "./session";

// ユーザー管理API等、「管理者権限」のユーザーのみ呼び出せるようにしたいAPI Routeで使う。
// ミドルウェアは「ログイン済みかどうか」までしかチェックしないため、ここでロールまで確認する。
export async function requireAdminSession(): Promise<SessionPayload | null> {
  const token = cookies().get(ADMIN_SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token);
  if (!session || session.role !== "admin") return null;
  return session;
}
