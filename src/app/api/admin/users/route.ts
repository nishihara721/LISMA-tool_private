import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { adminDb } from "@/lib/firebase-admin";
import { hashPassword } from "@/lib/password";
import { requireAdminSession } from "@/lib/require-admin";
import { REPORT_VIEWER_SELECTABLE_PAGES } from "@/lib/admin-pages";
import type { AdminUserDoc } from "@/types";

const SELECTABLE_PAGE_PATHS = new Set(REPORT_VIEWER_SELECTABLE_PAGES.map((p) => p.path));

// パスワードハッシュは一覧に含めない(クライアントへ送る必要がない情報のため)
function toPublicUser(user: AdminUserDoc) {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
}

// 画面を開くたびに最新の一覧を返す(ビルド時の内容を使い回さない)
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }
  const snap = await adminDb.collection("admin_users").orderBy("createdAt", "asc").get();
  const users = snap.docs.map((d) => toPublicUser(d.data() as AdminUserDoc));
  return NextResponse.json({ users });
}

// body: { loginId, password, displayName, role, allowedPages? }
export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const loginId = typeof body?.loginId === "string" ? body.loginId.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : "";
  const role = body?.role === "admin" ? "admin" : body?.role === "report_viewer" ? "report_viewer" : null;
  const allowedPages = Array.isArray(body?.allowedPages)
    ? body.allowedPages.filter((p: unknown) => typeof p === "string" && SELECTABLE_PAGE_PATHS.has(p))
    : [];

  if (!loginId || !password || !displayName || !role) {
    return NextResponse.json(
      { error: "ログインID・パスワード・表示名・権限はすべて必須です" },
      { status: 400 }
    );
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "パスワードは8文字以上にしてください" }, { status: 400 });
  }

  const existing = await adminDb.collection("admin_users").where("loginId", "==", loginId).limit(1).get();
  if (!existing.empty) {
    return NextResponse.json({ error: "このログインIDはすでに使用されています" }, { status: 400 });
  }

  const now = Date.now();
  const user: AdminUserDoc = {
    userId: nanoid(8),
    loginId,
    passwordHash: hashPassword(password),
    displayName,
    role,
    allowedPages: role === "report_viewer" ? allowedPages : undefined,
    createdAt: now,
    updatedAt: now,
  };
  await adminDb.collection("admin_users").doc(user.userId).set(user);

  return NextResponse.json({ ok: true, user: toPublicUser(user) });
}
