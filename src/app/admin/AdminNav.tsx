"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { isAdminPageGroup, manualBaseUrl, MANUAL_URL, type AdminNavEntry } from "@/lib/admin-pages";
import { NAV_ICON_BY_GROUP, NAV_ICON_BY_PATH, NavIcon } from "./icons";

type CurrentUser = {
  loginId: string;
  displayName: string;
  role: "admin" | "report_viewer";
};

// サイドメニューの描画・ホバー展開・ログアウトを担当するクライアントコンポーネント。
// どのページを表示するか(権限によるフィルタ)はサーバーコンポーネント側(layout.tsx)で決めて、
// フィルタ済みのitemsをpropsで受け取る。
//
// PC幅の構成: 左に「親メニューだけ」を並べた細い列(アイコンだけ)があり、
// 列にマウスを乗せると、名前とログイン中のユーザー名が見えるように横へ広がる(ページの上に重ねて表示)。
// 親メニューにマウスを乗せると、さらに右に子メニューの一覧(パネル)が開く。
// パネルはページの上に重ねて表示し、マウスが外れたら閉じる(ページ本体は動かさない)。
// スマホ幅では、従来どおり画面左から開くメニューに、親メニューと子メニューをすべて並べる。
export default function AdminNav({ items, user }: { items: AdminNavEntry[]; user: CurrentUser }) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  // スマホ幅では、サイドメニューを画面左から開閉するメニュー(ハンバーガーボタンで開く)にする
  const [menuOpen, setMenuOpen] = useState(false);
  // マウスを乗せている(またはタップした)親メニュー。子メニューのパネルに表示する
  const [hovered, setHovered] = useState<string | null>(null);

  // ページを移動したら、メニューを閉じる
  useEffect(() => {
    setMenuOpen(false);
    setHovered(null);
  }, [pathname]);

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

  // 子メニューのパネルは、親メニューにマウスを乗せている間だけ開く(外れたら閉じて、ページ本体を隠さない)
  const shown = hovered;

  return (
    <>
    <div className="admin-topbar">
      <button type="button" className="admin-hamburger" aria-label="メニューを開く" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
        <span aria-hidden>☰</span>
      </button>
      <span className="admin-topbar-title">engageツール</span>
    </div>
    {menuOpen && <div className="admin-backdrop" onClick={() => setMenuOpen(false)} aria-hidden />}
    <aside
      className={`admin-aside${menuOpen ? " admin-aside--open" : ""}`}
      onMouseLeave={() => setHovered(null)}
    >
      <div className="admin-rail">
      <div className="admin-nav-head">
        <span className="admin-nav-title">
          engage
          <br className="admin-nav-br" />
          ツール
        </span>
      </div>
      <nav className="admin-nav-list">
        {items.map((item) => {
          if (isAdminPageGroup(item)) {
            const hasActiveChild = item.children.some((child) => pathname === child.path);
            const isShown = shown === item.label;
            const icon = NAV_ICON_BY_GROUP[item.label];
            return (
              <div
                key={item.label}
                className={`admin-nav-group${isShown ? " admin-nav-group--shown" : ""}${hasActiveChild ? " admin-nav-group--active" : ""}`}
              >
                <button
                  type="button"
                  className="admin-nav-item admin-nav-group-head"
                  aria-expanded={isShown}
                  title={item.label}
                  onMouseEnter={() => setHovered(item.label)}
                  onFocus={() => setHovered(item.label)}
                  onClick={() => setHovered(item.label)}
                >
                  {icon && <NavIcon name={icon} size={22} />}
                  <span className="admin-nav-item-label">{item.label}</span>
                </button>
                {/* 子メニュー。PCでは親メニューの右に開くパネル、スマホでは親メニューの下に並べる */}
                <div className="admin-nav-panel">
                  <div className="admin-nav-panel-head">
                    <span className="admin-nav-panel-title">{item.label}</span>
                  </div>
                  {item.children.map((child) => {
                    const active = pathname === child.path;
                    return (
                      <Link
                        key={child.path}
                        href={child.path}
                        className={`admin-nav-child${active ? " admin-nav-child--active" : ""}`}
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
          const icon = NAV_ICON_BY_PATH[item.path];
          const inner = (
            <>
              {icon && <NavIcon name={icon} size={22} />}
              <span className="admin-nav-item-label">{item.label}</span>
            </>
          );
          if (item.externalUrl) {
            // 別URLのマニュアルを新しいタブで開く
            return (
              <a
                key={item.path}
                href={user.role === "report_viewer" && item.externalUrl === MANUAL_URL ? manualBaseUrl(user.role) : item.externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={item.label}
                className="admin-nav-item"
                onMouseEnter={() => setHovered(null)}
              >
                {inner}
              </a>
            );
          }
          return (
            <Link
              key={item.path}
              href={item.path}
              title={item.label}
              className={`admin-nav-item${active ? " admin-nav-item--active" : ""}`}
              onMouseEnter={() => setHovered(null)}
            >
              {inner}
            </Link>
          );
        })}
      </nav>
      <div className="admin-nav-foot" onMouseEnter={() => setHovered(null)}>
        <div className="admin-nav-userinfo">
          <div style={{ fontSize: 12.5, color: "#6b7f87", marginBottom: 4 }}>
            {user.displayName}({user.loginId})
          </div>
          <div style={{ fontSize: 11.5, color: "#9aacb2", marginBottom: 10 }}>
            {user.role === "admin" ? "管理者権限" : "レポート閲覧権限"}
          </div>
        </div>
        <button
          type="button"
          className="admin-nav-logout"
          onClick={handleLogout}
          disabled={loggingOut}
          title={`ログアウト(${user.displayName}・${user.role === "admin" ? "管理者権限" : "レポート閲覧権限"})`}
        >
          <NavIcon name="exit" size={20} />
          <span className="admin-nav-item-label">ログアウト</span>
        </button>
      </div>
      </div>
    </aside>
    </>
  );
}
