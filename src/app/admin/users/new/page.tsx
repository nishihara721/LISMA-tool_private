"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import * as ui from "../../ui";
import { REPORT_VIEWER_SELECTABLE_PAGES } from "@/lib/admin-pages";
import type { AdminRole } from "@/lib/session";

export default function NewAdminUserPage() {
  const router = useRouter();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<AdminRole>("report_viewer");
  const [allowedPages, setAllowedPages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  function togglePage(path: string) {
    setAllowedPages((prev) => (prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]));
  }

  async function handleCreate() {
    if (!loginId || !password || !displayName) {
      alert("ログインID・パスワード・表示名を入力してください");
      return;
    }
    if (password.length < 8) {
      alert("パスワードは8文字以上にしてください");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId, password, displayName, role, allowedPages }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push("/admin/users");
    } catch (e) {
      alert(`登録に失敗しました: ${e}`);
      setBusy(false);
    }
  }

  return (
    <main style={ui.page}>
      <Link href="/admin/users" style={ui.backLink}>
        ← ユーザー一覧へ戻る
      </Link>
      <h1 style={ui.h1}>ユーザーの新規登録</h1>

      <section style={ui.section}>
        <div style={ui.field}>
          <label style={ui.label}>ログインID</label>
          <input
            style={{ ...ui.input, maxWidth: 260 }}
            value={loginId}
            onChange={(e) => setLoginId(e.target.value)}
            autoFocus
            placeholder="例: abc12345"
          />
        </div>
        <div style={ui.field}>
          <label style={ui.label}>パスワード</label>
          <input
            type="password"
            style={{ ...ui.input, maxWidth: 260 }}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="8文字以上"
          />
        </div>
        <div style={ui.field}>
          <label style={ui.label}>表示名</label>
          <input
            style={{ ...ui.input, maxWidth: 260 }}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="例: ファイブエス 太郎"
          />
        </div>
        <div style={ui.field}>
          <label style={ui.label}>権限</label>
          <select
            style={{ ...ui.input, maxWidth: 260 }}
            value={role}
            onChange={(e) => setRole(e.target.value as AdminRole)}
          >
            <option value="report_viewer">レポート閲覧権限</option>
            <option value="admin">管理者権限</option>
          </select>
        </div>

        {role === "report_viewer" && (
          <div style={ui.field}>
            <label style={ui.label}>閲覧できるページ</label>
            <div
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 8,
                padding: 16,
                display: "flex",
                flexDirection: "column",
                gap: 12,
                maxWidth: 420,
              }}
            >
              {REPORT_VIEWER_SELECTABLE_PAGES.map((page) => (
                <label key={page.path} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5 }}>
                  <input
                    type="checkbox"
                    checked={allowedPages.includes(page.path)}
                    onChange={() => togglePage(page.path)}
                  />
                  {page.label}
                </label>
              ))}
            </div>
          </div>
        )}

        <button style={ui.buttonPrimary} onClick={handleCreate} disabled={busy}>
          {busy ? "登録中..." : "登録する"}
        </button>
      </section>
    </main>
  );
}
