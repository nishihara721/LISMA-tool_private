"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import * as ui from "../ui";
import { ADMIN_PAGES, REPORT_VIEWER_SELECTABLE_PAGES } from "@/lib/admin-pages";
import type { AdminRole } from "@/lib/session";

type AdminUserRow = {
  userId: string;
  loginId: string;
  displayName: string;
  role: AdminRole;
  allowedPages?: string[];
  createdAt: number;
};

type EditFields = {
  displayName: string;
  role: AdminRole;
  allowedPages: string[];
  password: string;
};

function pageLabel(path: string): string {
  return ADMIN_PAGES.find((p) => p.path === path)?.label ?? path;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditFields | null>(null);

  useEffect(() => {
    fetchUsers();
  }, []);

  async function fetchUsers() {
    const res = await fetch("/api/admin/users");
    const data = await res.json();
    setUsers(data.users ?? []);
  }

  function startEdit(user: AdminUserRow) {
    setEditingId(user.userId);
    setEdit({
      displayName: user.displayName,
      role: user.role,
      allowedPages: user.allowedPages ?? [],
      password: "",
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEdit(null);
  }

  function togglePage(path: string) {
    setEdit((v) => {
      if (!v) return v;
      const allowedPages = v.allowedPages.includes(path)
        ? v.allowedPages.filter((p) => p !== path)
        : [...v.allowedPages, path];
      return { ...v, allowedPages };
    });
  }

  async function handleUpdate(userId: string) {
    if (!edit) return;
    if (!edit.displayName) {
      alert("表示名を入力してください");
      return;
    }
    if (edit.password && edit.password.length < 8) {
      alert("パスワードは8文字以上にしてください");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: edit.displayName,
          role: edit.role,
          allowedPages: edit.allowedPages,
          password: edit.password || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      cancelEdit();
      await fetchUsers();
    } catch (e) {
      alert(`更新に失敗しました: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(user: AdminUserRow) {
    if (!confirm(`「${user.displayName}(${user.loginId})」を削除しますか？`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${user.userId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await fetchUsers();
    } catch (e) {
      alert(`削除に失敗しました: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={ui.pageWide}>
      <div style={ui.headerRow}>
        <h1 style={{ ...ui.h1, margin: 0 }}>ユーザー管理</h1>
        <Link href="/admin/users/new" style={{ ...ui.buttonPrimary, textDecoration: "none" }}>
          ＋ 新規登録
        </Link>
      </div>

      <div style={ui.tableScroll}>
        <table style={ui.table} className="admin-table">
          <thead>
            <tr>
              <th style={ui.th}>ログインID</th>
              <th style={ui.th}>表示名</th>
              <th style={ui.th}>権限</th>
              <th style={ui.th}>閲覧できるページ</th>
              <th style={ui.th}>登録日時</th>
              <th style={{ ...ui.th, width: 280 }} />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isEditing = editingId === u.userId;
              return (
                <tr key={u.userId}>
                  <td style={ui.td}>{u.loginId}</td>
                  {isEditing && edit ? (
                    <>
                      <td style={ui.td}>
                        <input
                          style={{ ...ui.input, maxWidth: 160 }}
                          value={edit.displayName}
                          onChange={(e) => setEdit((v) => (v ? { ...v, displayName: e.target.value } : v))}
                          autoFocus
                        />
                      </td>
                      <td style={ui.td}>
                        <select
                          style={{ ...ui.input, maxWidth: 160 }}
                          value={edit.role}
                          onChange={(e) => setEdit((v) => (v ? { ...v, role: e.target.value as AdminRole } : v))}
                        >
                          <option value="report_viewer">レポート閲覧権限</option>
                          <option value="admin">管理者権限</option>
                        </select>
                      </td>
                      <td style={ui.td}>
                        {edit.role === "report_viewer" ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 360 }}>
                            {REPORT_VIEWER_SELECTABLE_PAGES.map((page) => (
                              <label key={page.path} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                                <input
                                  type="checkbox"
                                  checked={edit.allowedPages.includes(page.path)}
                                  onChange={() => togglePage(page.path)}
                                />
                                {page.label}
                              </label>
                            ))}
                          </div>
                        ) : (
                          <span style={ui.hint}>全ページ</span>
                        )}
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={ui.td}>{u.displayName}</td>
                      <td style={ui.td}>{u.role === "admin" ? "管理者権限" : "レポート閲覧権限"}</td>
                      <td style={ui.td}>
                        {u.role === "admin" ? (
                          <span style={ui.hint}>全ページ</span>
                        ) : (u.allowedPages ?? []).length === 0 ? (
                          <span style={ui.hint}>(未設定)</span>
                        ) : (
                          (u.allowedPages ?? []).map((p) => pageLabel(p)).join("、")
                        )}
                      </td>
                    </>
                  )}
                  <td style={ui.td}>{new Date(u.createdAt).toLocaleString("ja-JP")}</td>
                  <td style={ui.td}>
                    {isEditing && edit ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 250 }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <label style={{ fontSize: 12.5, fontWeight: 600, color: "#33474f" }}>パスワードを変更する</label>
                          <input
                            type="password"
                            style={{ ...ui.input, maxWidth: 250 }}
                            value={edit.password}
                            onChange={(e) => setEdit((v) => (v ? { ...v, password: e.target.value } : v))}
                            placeholder="変更する場合のみ入力(8文字以上)"
                            autoComplete="new-password"
                          />
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            style={{ ...ui.buttonPrimary, padding: "6px 18px", fontSize: 12.5 }}
                            onClick={() => handleUpdate(u.userId)}
                            disabled={busy}
                          >
                            保存
                          </button>
                          <button style={{ ...ui.buttonSmall, padding: "6px 18px" }} onClick={cancelEdit} disabled={busy}>
                            キャンセル
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <button style={ui.buttonSmall} onClick={() => startEdit(u)}>
                          編集
                        </button>
                        <button style={{ ...ui.buttonSmall, marginLeft: 8 }} onClick={() => handleDelete(u)} disabled={busy}>
                          削除
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
