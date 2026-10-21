"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { isAdminPageGroup, manualBaseUrl, MANUAL_URL, type AdminNavEntry } from "@/lib/admin-pages";

type CurrentUser = {
  loginId: string;
  displayName: string;
  role: "admin" | "report_viewer";
};

// サイドメニューの描画・ホバー展開・ログアウトを担当するクライアントコンポーネント。
// どのページを表示するか(権限によるフィルタ)はサーバーコンポーネント側(layout.tsx)で決めて、
// フィルタ済みのitemsをpropsで受け取る。
export default function AdminNav({ items, user }: { items: AdminNavEntry[]; user: CurrentUser }) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <aside
      style={{
        width: 232,
        flexShrink: 0,
        background: "#eef3f6",
        borderRight: "1px solid #dde5ea",
        padding: "28px 0",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ padding: "0 24px 24px", fontWeight: 600, fontSize: 15, color: "#33474f" }}>
        LINE友だち管理ツール
      </div>
      <nav style={{ flex: 1 }}>
        {items.map((item) => {
          if (isAdminPageGroup(item)) {
            // 配下の項目は普段は隠しておき、見出しにマウスを乗せた時だけ展開する(CSSの:hoverで制御)。
            // ただし配下のページを表示中は、ホバーしていなくても展開したままにする。
            const hasActiveChild = item.children.some((child) => pathname === child.path);
            return (
              <div
                key={item.label}
                className={`admin-nav-group${hasActiveChild ? " admin-nav-group--active" : ""}`}
                style={{ padding: 0 }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    padding: "11px 24px",
                    fontSize: 13.5,
                    color: "#33474f",
                    cursor: "default",
                  }}
                >
                  {item.label}
                  <span className="admin-nav-group-arrow" style={{ fontSize: 11, color: "#9aacb2" }}>
                    ∨
                  </span>
                </div>
                <div
                  className={`admin-nav-group-children${hasActiveChild ? " admin-nav-group-children--open" : ""}`}
                >
                  {item.children.map((child) => {
                    const active = pathname === child.path;
                    return (
                      <Link
                        key={child.path}
                        href={child.path}
                        style={{
                          display: "block",
                          padding: "9px 24px 9px 36px",
                          fontSize: 13.5,
                          textDecoration: "none",
                          color: active ? "#ffffff" : "#33474f",
                          background: active ? "#7bb8d4" : "transparent",
                          borderLeft: active ? "none" : "2px solid #dde5ea",
                          marginLeft: 24,
                        }}
                      >
                        {child.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          }

          const active = pathname === item.path;
          if (item.externalUrl) {
            // 別URLのマニュアルを新しいタブで開く
            return (
              <a
                key={item.path}
                href={user.role === "report_viewer" && item.externalUrl === MANUAL_URL ? manualBaseUrl(user.role) : item.externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "block", padding: "11px 24px", fontSize: 13.5, textDecoration: "none", color: "#33474f" }}
              >
                {item.label}
              </a>
            );
          }
          return (
            <Link
              key={item.path}
              href={item.path}
              style={{
                display: "block",
                padding: "11px 24px",
                fontSize: 13.5,
                textDecoration: "none",
                color: active ? "#ffffff" : "#33474f",
                background: active ? "#7bb8d4" : "transparent",
              }}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div style={{ padding: "16px 24px 0", borderTop: "1px solid #dde5ea" }}>
        <div style={{ fontSize: 12.5, color: "#6b7f87", marginBottom: 4 }}>
          {user.displayName}({user.loginId})
        </div>
        <div style={{ fontSize: 11.5, color: "#9aacb2", marginBottom: 10 }}>
          {user.role === "admin" ? "管理者権限" : "レポート閲覧権限"}
        </div>
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          style={{
            fontSize: 12.5,
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid #c7d2d6",
            background: "#ffffff",
            color: "#33474f",
          }}
        >
          ログアウト
        </button>
      </div>
    </aside>
  );
}
