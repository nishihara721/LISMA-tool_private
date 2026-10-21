"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import type { SourceDoc } from "@/types";
import * as ui from "../ui";
import RowMenu from "../RowMenu";
import Pager from "../Pager";
import SourceImportPanel from "./SourceImportPanel";
import { buildSourceName } from "@/lib/source-name";

type EditFields = {
  placement: string;
  appeal: string;
  popup: string;
  scenario: string;
  exitPoint: string;
  intermediatePage: string;
  other: string;
  lstepUrl: string;
};

const EDIT_FIELD_DEFS: { key: Exclude<keyof EditFields, "lstepUrl">; label: string }[] = [
  { key: "placement", label: "設置先" },
  { key: "appeal", label: "訴求" },
  { key: "popup", label: "ポップアップ" },
  { key: "scenario", label: "シナリオ" },
  { key: "exitPoint", label: "離脱地点" },
  { key: "intermediatePage", label: "中間ページ" },
  { key: "other", label: "その他" },
];

const EMPTY_EDIT: EditFields = {
  placement: "",
  appeal: "",
  popup: "",
  scenario: "",
  exitPoint: "",
  intermediatePage: "",
  other: "",
  lstepUrl: "",
};

// 構成要素が1つも登録されていない(=この項目群が追加される前からの)既存データかどうかを判定する
function hasNoStructuredParts(source: SourceDoc): boolean {
  return (
    !source.placement &&
    !source.appeal &&
    !source.popup &&
    !source.scenario &&
    !source.exitPoint &&
    !source.intermediatePage
  );
}

export default function SourcesAdminPage() {
  const [sources, setSources] = useState<SourceDoc[]>([]);
  const [busy, setBusy] = useState(false);
  // 50件ずつ表示する
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditFields>(EMPTY_EDIT);

  useEffect(() => {
    fetchSources();
  }, []);

  async function fetchSources() {
    const res = await fetch("/api/sources");
    const data = await res.json();
    setSources(data.sources ?? []);
  }

  function startEdit(source: SourceDoc) {
    setEditingId(source.sourceId);
    setEdit({
      placement: source.placement ?? "",
      appeal: source.appeal ?? "",
      popup: source.popup ?? "",
      scenario: source.scenario ?? "",
      exitPoint: source.exitPoint ?? "",
      intermediatePage: source.intermediatePage ?? "",
      // 構成要素が1つも無い(=この項目が追加される前からの)既存データは、
      // 中身を失わないよう「その他」に元のnameをそのまま引き継いで編集できるようにする
      other: source.other ?? (hasNoStructuredParts(source) ? source.name : ""),
      lstepUrl: source.lstepUrl ?? "",
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEdit(EMPTY_EDIT);
  }

  const editPreviewName = buildSourceName({
    placement: edit.placement,
    appeal: edit.appeal,
    popup: edit.popup,
    scenario: edit.scenario,
    exitPoint: edit.exitPoint,
    intermediatePage: edit.intermediatePage,
    other: edit.other,
  });

  async function handleUpdate(sourceId: string) {
    if (!editPreviewName) {
      alert("いずれかの項目を入力してください");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/sources/${sourceId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          placement: edit.placement,
          appeal: edit.appeal,
          popup: edit.popup,
          scenario: edit.scenario,
          exitPoint: edit.exitPoint,
          intermediatePage: edit.intermediatePage,
          other: edit.other,
          lstepUrl: edit.lstepUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      cancelEdit();
      await fetchSources();
    } catch (e) {
      alert(`更新に失敗しました: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDuplicate(source: SourceDoc) {
    setBusy(true);
    try {
      const res = await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          placement: source.placement,
          appeal: source.appeal,
          popup: source.popup,
          scenario: source.scenario,
          exitPoint: source.exitPoint,
          intermediatePage: source.intermediatePage,
          // 構成要素が1つも無い既存データはnameを、それ以外は既存の「その他」を引き継ぎつつ
          // 「のコピー」を付けて区別できるようにする
          other: `${source.other ?? (hasNoStructuredParts(source) ? source.name : "")}のコピー`,
          lstepUrl: source.lstepUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await fetchSources();
    } catch (e) {
      alert(`複製に失敗しました: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(source: SourceDoc) {
    if (!confirm(`「${source.name}」を削除しますか？(すでに計測されたクリック・成果のデータは残ります)`)) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/sources/${source.sourceId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await fetchSources();
    } catch (e) {
      alert(`削除に失敗しました: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  function trackingLink(sourceId: string) {
    const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
    return `https://liff.line.me/${liffId}?mode=add_friend&sourceId=${sourceId}`;
  }

  async function handleCopy(sourceId: string) {
    await navigator.clipboard.writeText(trackingLink(sourceId));
    setCopiedId(sourceId);
    setTimeout(() => setCopiedId(null), 1500);
  }

  const pageCount = Math.max(1, Math.ceil(sources.length / PAGE_SIZE));
  // 削除などで件数が減り、現在のページが無くなった場合は最後のページに戻す
  useEffect(() => {
    if (page >= pageCount) setPage(pageCount - 1);
  }, [page, pageCount]);

  return (
    <main style={ui.pageWide}>
      <div style={ui.headerRow}>
        <h1 style={{ ...ui.h1, margin: 0 }}>流入経路管理</h1>
        <Link href="/admin/sources/new" style={{ ...ui.buttonPrimary, textDecoration: "none" }}>
          ＋ 新規登録
        </Link>
      </div>

      <SourceImportPanel onImported={fetchSources} />

      <div style={ui.tableScroll}>
        <table style={ui.table} className="admin-table">
          <thead>
            <tr>
              <th style={ui.th}>名前</th>
              <th style={ui.th}>計測リンク</th>
              <th style={ui.th}>Lステップ流入経路リンク</th>
              <th style={ui.th}>登録日時</th>
              <th style={{ ...ui.th, width: 48 }} />
            </tr>
          </thead>
          <tbody>
            {sources.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((s) => {
              const isEditing = editingId === s.sourceId;
              return (
              <Fragment key={s.sourceId}>
              <tr>
                <td style={ui.td}>{isEditing ? editPreviewName || <span style={ui.hint}>(未入力)</span> : s.name}</td>
                <td style={ui.td}>
                  <code style={ui.code}>{trackingLink(s.sourceId)}</code>
                  <button style={{ ...ui.buttonSmall, marginLeft: 8 }} onClick={() => handleCopy(s.sourceId)}>
                    {copiedId === s.sourceId ? "コピーしました" : "コピー"}
                  </button>
                </td>
                <td style={ui.td}>
                  {s.lstepUrl ? <code style={ui.code}>{s.lstepUrl}</code> : <span style={ui.hint}>未設定</span>}
                </td>
                <td style={ui.td}>{new Date(s.createdAt).toLocaleString("ja-JP")}</td>
                <td style={ui.td}>
                  {isEditing ? (
                    <span style={ui.hint}>編集中</span>
                  ) : (
                    <RowMenu
                      onEdit={() => startEdit(s)}
                      onDuplicate={() => handleDuplicate(s)}
                      onDelete={() => handleDelete(s)}
                    />
                  )}
                </td>
              </tr>
              {isEditing && (
                <tr>
                  <td style={{ ...ui.td, background: "#f6f9fb" }} colSpan={5}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: "10px 14px", marginBottom: 12 }}>
                      {EDIT_FIELD_DEFS.map((f) => (
                        <label key={f.key} style={{ display: "block", fontSize: 12.5 }}>
                          <span style={{ display: "block", marginBottom: 3 }}>{f.label}</span>
                          <input
                            style={{ ...ui.input, width: "100%" }}
                            value={edit[f.key]}
                            onChange={(e) => setEdit((v) => ({ ...v, [f.key]: e.target.value }))}
                            autoFocus={f.key === "placement"}
                          />
                        </label>
                      ))}
                    </div>
                    <label style={{ display: "block", fontSize: 12.5, marginBottom: 12 }}>
                      <span style={{ display: "block", marginBottom: 3 }}>Lステップ流入経路リンク(任意)</span>
                      <input
                        style={{ ...ui.input, width: "100%", maxWidth: 520 }}
                        value={edit.lstepUrl}
                        onChange={(e) => setEdit((v) => ({ ...v, lstepUrl: e.target.value }))}
                        placeholder="https://line.me/R/ti/p/@xxx?... など"
                      />
                    </label>
                    <div style={{ fontSize: 12.5, marginBottom: 10 }}>
                      結合後の名前: <strong>{editPreviewName || <span style={ui.hint}>(未入力)</span>}</strong>
                    </div>
                    <button style={ui.buttonSmall} onClick={() => handleUpdate(s.sourceId)} disabled={busy}>
                      保存
                    </button>
                    <button style={{ ...ui.buttonSmall, marginLeft: 8 }} onClick={cancelEdit}>
                      キャンセル
                    </button>
                  </td>
                </tr>
              )}
              </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager
        page={page + 1}
        totalPages={pageCount}
        pageSize={PAGE_SIZE}
        hasPrev={page > 0}
        hasNext={page + 1 < pageCount}
        onPrev={() => setPage((p) => p - 1)}
        onNext={() => setPage((p) => p + 1)}
      />
    </main>
  );
}
