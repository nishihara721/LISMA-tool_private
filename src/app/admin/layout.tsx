import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  ADMIN_NAV_ITEMS,
  ADMIN_USERS_PAGE,
  isAdminPageGroup,
  type AdminNavEntry,
} from "@/lib/admin-pages";
import { ADMIN_SESSION_COOKIE, canAccessPage, verifySessionToken } from "@/lib/session";
import AdminNav from "./AdminNav";
import ManualButton from "./ManualButton";
import { CurrentUserProvider } from "./CurrentUserContext";

// ログインユーザーの権限(role)に応じて、サイドメニューに表示する項目を絞り込む。
// - admin: 全項目 + ユーザー管理
// - report_viewer: allowedPagesに含まれる項目のみ(配下が0件になったグループは非表示にする)
function filterNavItems(
  items: AdminNavEntry[],
  session: Awaited<ReturnType<typeof verifySessionToken>>
): AdminNavEntry[] {
  if (!session) return [];
  if (session.role === "admin") return [...items, ADMIN_USERS_PAGE];

  return items
    .map((item): AdminNavEntry | null => {
      if (isAdminPageGroup(item)) {
        const children = item.children.filter((child) => canAccessPage(session, child.path));
        return children.length > 0 ? { ...item, children } : null;
      }
      return canAccessPage(session, item.path) ? item : null;
    })
    .filter((item): item is AdminNavEntry => item !== null);
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // ミドルウェアで未ログインは/loginへリダイレクト済みだが、念のためここでも検証する(多層防御)。
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token);
  if (!session) {
    redirect("/login");
  }

  const navItems = filterNavItems(ADMIN_NAV_ITEMS, session);

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <AdminNav
        items={navItems}
        user={{ loginId: session.loginId, displayName: session.displayName, role: session.role }}
      />
      <main className="admin-main" style={{ flex: 1, minWidth: 0, position: "relative" }}>
        <ManualButton role={session.role} />
        <CurrentUserProvider role={session.role}>{children}</CurrentUserProvider>
      </main>
    </div>
  );
}
