import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { hashPassword } from "@/lib/password";
import { requireAdminSession } from "@/lib/require-admin";
import { REPORT_VIEWER_SELECTABLE_PAGES } from "@/lib/admin-pages";
import type { AdminUserDoc } from "@/types";

const SELECTABLE_PAGE_PATHS = new Set(REPORT_VIEWER_SELECTABLE_PAGES.map((p) => p.path));

// body: { displayName?, role?, allowedPages?, password? }
// loginIdは変更不可(ログインの一意キーのため、変更したい場合は削除して作り直す運用とする)。
// passwordは、入力があった場合のみ更新する(空欄なら変更しない)。
export async function PUT(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }

  const { userId } = await params;
  const ref = adminDb.collection("admin_users").doc(userId);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "指定されたユーザーが見つかりません" }, { status: 404 });
  }
  const existing = snap.data() as AdminUserDoc;

  const body = await req.json().catch(() => null);
  const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : "";
  const role = body?.role === "admin" ? "admin" : body?.role === "report_viewer" ? "report_viewer" : null;
  const allowedPages = Array.isArray(body?.allowedPages)
    ? body.allowedPages.filter((p: unknown) => typeof p === "string" && SELECTABLE_PAGE_PATHS.has(p))
    : [];
  const password = typeof body?.password === "string" ? body.password : "";

  if (!displayName || !role) {
    return NextResponse.json({ error: "表示名・権限は必須です" }, { status: 400 });
  }
  if (password && password.length < 8) {
    return NextResponse.json({ error: "パスワードは8文字以上にしてください" }, { status: 400 });
  }

  // 自分自身を管理者権限から降格させて、ログイン後にユーザー管理ページへ入れなくなる事故を防ぐ
  if (existing.userId === session.userId && role !== "admin") {
    return NextResponse.json({ error: "自分自身の権限を管理者権限以外に変更することはできません" }, { status: 400 });
  }

  await ref.update({
    displayName,
    role,
    allowedPages: role === "report_viewer" ? allowedPages : FieldValue.delete(),
    ...(password ? { passwordHash: hashPassword(password) } : {}),
    updatedAt: Date.now(),
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }

  const { userId } = await params;
  if (userId === session.userId) {
    return NextResponse.json({ error: "自分自身を削除することはできません" }, { status: 400 });
  }

  await adminDb.collection("admin_users").doc(userId).delete();
  return NextResponse.json({ ok: true });
}
