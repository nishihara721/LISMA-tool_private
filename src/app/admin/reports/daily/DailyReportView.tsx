"use client";

import { useEffect, useState } from "react";
import { formatYen } from "@/lib/format-yen";
import * as ui from "../../ui";
import { EditPencilIcon } from "../../icons";
import { daysAgoJST, todayJST } from "@/lib/csv-client";
import { useCanEditReports } from "../../CurrentUserContext";
import { MEMO_MAX_LENGTH, parseMemo } from "@/lib/memo-links";
import { buildMonthlyDisplayItems, formatMonthLabel } from "@/lib/monthly-totals";

type DailyReportRow = {
  date: string;
  pvCount: number | null;
  impCount: number | null;
  impRate: number | null;
  clCount: number | null;
  clRate: number | null;
  friendCount: number;
  friendAddRate: number | null;
  cvCount: number;
  cvr: number | null;
  billingAmount: number;
  memo?: string;
};

export default function DailyReportView({ modeSwitch }: { modeSwitch?: React.ReactNode }) {
  const canEdit = useCanEditReports();
  const [from, setFrom] = useState(daysAgoJST(29));
  const [to, setTo] = useState(todayJST());
  const [rows, setRows] = useState<DailyReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");
  const [busy, setBusy] = useState(false);
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [editPv, setEditPv] = useState("");
  const [editImp, setEditImp] = useState("");
  const [editCl, setEditCl] = useState("");
  const [editMemo, setEditMemo] = useState("");

  useEffect(() => {
    fetchReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchReport() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/report/daily?from=${from}&to=${to}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "取得に失敗しました");
      setRows(data.rows ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  function startEdit(row: DailyReportRow) {
    setEditingDate(row.date);
    setEditPv(row.pvCount === null ? "" : String(row.pvCount));
    setEditImp(row.impCount === null ? "" : String(row.impCount));
    setEditCl(row.clCount === null ? "" : String(row.clCount));
    setEditMemo(row.memo ?? "");
  }

  function cancelEdit() {
    setEditingDate(null);
  }

  // 空欄で保存した場合はnullを送って「未入力」の状態(未インポート扱い)に戻す。
  // 数値が入っていればその値をそのまま設定する。
  async function saveEdit(date: string) {
    const toValue = (text: string): number | null => {
      const trimmed = text.trim();
      return trimmed === "" ? null : Number(trimmed);
    };
    const pvCount = toValue(editPv);
    const impCount = toValue(editImp);
    const clCount = toValue(editCl);
    if ([pvCount, impCount, clCount].some((v) => v !== null && Number.isNaN(v))) {
      alert("PV数・imp数・CL数は数値で入力してください(空欄も可)");
      return;
    }

    if (editMemo.length > MEMO_MAX_LENGTH) {
      alert(`メモは${MEMO_MAX_LENGTH}文字以内で入力してください`);
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/report/ad-metrics/${date}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pvCount, impCount, clCount, memo: editMemo }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "更新に失敗しました");
      setEditingDate(null);
      await fetchReport();
    } catch (e) {
      alert(`更新に失敗しました: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  const sortedRows = [...rows].sort((a, b) =>
    sortOrder === "asc" ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)
  );


  // 月ごとの総計行(並び順に応じて、各月のまとまりの先頭に来るように挿入する)用の集計
  function totalsOf(subset: DailyReportRow[]) {
    const pv = subset.some((r) => r.pvCount !== null) ? subset.reduce((sum, r) => sum + (r.pvCount ?? 0), 0) : null;
    const imp = subset.some((r) => r.impCount !== null)
      ? subset.reduce((sum, r) => sum + (r.impCount ?? 0), 0)
      : null;
    const impRate = imp !== null && pv !== null && pv > 0 ? Math.round((imp / pv) * 1000) / 10 : null;
    const cl = subset.some((r) => r.clCount !== null) ? subset.reduce((sum, r) => sum + (r.clCount ?? 0), 0) : null;
    const clRate = cl !== null && imp !== null && imp > 0 ? Math.round((cl / imp) * 1000) / 10 : null;
    const friend = subset.reduce((sum, r) => sum + r.friendCount, 0);
    const friendAddRate = cl !== null && cl > 0 ? Math.round((friend / cl) * 1000) / 10 : null;
    const cv = subset.reduce((sum, r) => sum + r.cvCount, 0);
    const cvr = friend > 0 ? Math.round((cv / friend) * 1000) / 10 : null;
    const billing = subset.reduce((sum, r) => sum + r.billingAmount, 0);
    return { pv, imp, impRate, cl, clRate, friend, friendAddRate, cv, cvr, billing };
  }

  const displayItems = buildMonthlyDisplayItems(sortedRows, (r) => r.date, sortOrder, totalsOf);

  function downloadCsv() {
    const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const header = [
      "日付",
      "PV数",
      "imp数",
      "imp率(%)",
      "CL数",
      "CL率(%)",
      "友だち追加数",
      "友だち追加率(%)",
      "CV数",
      "CVR(%)",
      "請求額(円)",
      "メモ",
    ]
      .map(escape)
      .join(",");
    const numOrDash = (v: number | null) => (v === null ? "-" : String(v));
    const lines = sortedRows.map((r) =>
      [
        r.date,
        numOrDash(r.pvCount),
        numOrDash(r.impCount),
        numOrDash(r.impRate),
        numOrDash(r.clCount),
        numOrDash(r.clRate),
        String(r.friendCount),
        numOrDash(r.friendAddRate),
        String(r.cvCount),
        numOrDash(r.cvr),
        String(r.billingAmount),
        r.memo ?? "",
      ]
        .map(escape)
        .join(",")
    );
    const csv = "﻿" + [header, ...lines].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `日次レポート_${from}_${to}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <main style={ui.pageWide}>
      <h1 style={ui.h1}>日次・月次レポート</h1>
      {modeSwitch}

      <div style={ui.filterBar}>
        <div style={ui.filterField}>
          <label style={ui.filterLabel}>期間(開始)</label>
          <input type="date" style={ui.filterInput} value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div style={ui.filterField}>
          <label style={ui.filterLabel}>期間(終了)</label>
          <input type="date" style={ui.filterInput} value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <button type="button" style={ui.buttonPrimary} onClick={fetchReport} disabled={loading}>
          {loading ? "取得中…" : "表示"}
        </button>
      </div>

      {error && <p style={{ color: "#c0392b", fontSize: 13 }}>{error}</p>}


      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
        <button type="button" style={ui.buttonSmall} onClick={downloadCsv} disabled={rows.length === 0}>
          CSVダウンロード
        </button>
      </div>

      <div style={ui.tableScroll}>
        <table style={ui.table} className="admin-table">
          <thead>
            <tr>
              <th style={ui.th}>
                <button
                  type="button"
                  onClick={() => setSortOrder((o) => (o === "asc" ? "desc" : "asc"))}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    border: "none",
                    background: "transparent",
                    padding: 0,
                    font: "inherit",
                    color: "inherit",
                    cursor: "pointer",
                  }}
                  title="クリックで日付の並び順を切り替え"
                >
                  日付 {sortOrder === "asc" ? "▲" : "▼"}
                </button>
              </th>
              <th style={ui.th}>PV数</th>
              <th style={ui.th}>imp数</th>
              <th style={ui.th}>imp率</th>
              <th style={ui.th}>CL数</th>
              <th style={ui.th}>CL率</th>
              <th style={ui.th}>友だち追加数</th>
              <th style={ui.th}>友だち追加率</th>
              <th style={ui.th}>CV数</th>
              <th style={ui.th}>CVR</th>
              <th style={{ ...ui.th, textAlign: "right" }}>請求額</th>
              <th style={{ ...ui.th, minWidth: 220 }}>メモ</th>
              <th style={{ ...ui.th, width: 60 }} />
            </tr>
          </thead>
          <tbody>
            {displayItems.map((item) => {
              if (item.kind === "total") {
                const t = item.totals;
                return (
                  <tr key={`total-${item.monthKey}`} style={{ background: "#eef3f6", fontWeight: 600 }}>
                    <td style={ui.td}>{formatMonthLabel(item.monthKey)} 合計</td>
                    <td style={ui.td}>{t.pv === null ? "-" : t.pv}</td>
                    <td style={ui.td}>{t.imp === null ? "-" : t.imp}</td>
                    <td style={ui.td}>{t.impRate === null ? "-" : `${t.impRate}%`}</td>
                    <td style={ui.td}>{t.cl === null ? "-" : t.cl}</td>
                    <td style={ui.td}>{t.clRate === null ? "-" : `${t.clRate}%`}</td>
                    <td style={ui.td}>{t.friend}</td>
                    <td style={ui.td}>{t.friendAddRate === null ? "-" : `${t.friendAddRate}%`}</td>
                    <td style={ui.td}>{t.cv}</td>
                    <td style={ui.td}>{t.cvr === null ? "-" : `${t.cvr}%`}</td>
                    <td style={{ ...ui.td, textAlign: "right", whiteSpace: "nowrap" }}>{formatYen(t.billing)}</td>
                    <td style={ui.td} />
                    <td style={ui.td} />
                  </tr>
                );
              }
              const r = item.row;
              const isEditing = editingDate === r.date;
              return (
                <tr key={r.date}>
                  <td style={ui.td}>{r.date}</td>
                  {isEditing ? (
                    <>
                      <td style={ui.td}>
                        <input
                          type="number"
                          style={{ ...ui.input, width: 80, maxWidth: 80 }}
                          value={editPv}
                          onChange={(e) => setEditPv(e.target.value)}
                          placeholder="未入力"
                        />
                      </td>
                      <td style={ui.td}>
                        <input
                          type="number"
                          style={{ ...ui.input, width: 80, maxWidth: 80 }}
                          value={editImp}
                          onChange={(e) => setEditImp(e.target.value)}
                          placeholder="未入力"
                        />
                      </td>
                      <td style={ui.td}>{r.impRate === null ? "-" : `${r.impRate}%`}</td>
                      <td style={ui.td}>
                        <input
                          type="number"
                          style={{ ...ui.input, width: 80, maxWidth: 80 }}
                          value={editCl}
                          onChange={(e) => setEditCl(e.target.value)}
                          placeholder="未入力"
                        />
                      </td>
                      <td style={ui.td}>{r.clRate === null ? "-" : `${r.clRate}%`}</td>
                    </>
                  ) : (
                    <>
                      <td style={ui.td}>{r.pvCount === null ? "-" : r.pvCount}</td>
                      <td style={ui.td}>{r.impCount === null ? "-" : r.impCount}</td>
                      <td style={ui.td}>{r.impRate === null ? "-" : `${r.impRate}%`}</td>
                      <td style={ui.td}>{r.clCount === null ? "-" : r.clCount}</td>
                      <td style={ui.td}>{r.clRate === null ? "-" : `${r.clRate}%`}</td>
                    </>
                  )}
                  <td style={ui.td}>{r.friendCount}</td>
                  <td style={ui.td}>{r.friendAddRate === null ? "-" : `${r.friendAddRate}%`}</td>
                  <td style={ui.td}>{r.cvCount}</td>
                  <td style={ui.td}>{r.cvr === null ? "-" : `${r.cvr}%`}</td>
                  <td style={{ ...ui.td, textAlign: "right", whiteSpace: "nowrap" }}>{formatYen(r.billingAmount)}</td>
                  <td style={{ ...ui.td, minWidth: 220, maxWidth: 360, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                    {isEditing && canEdit ? (
                      <textarea
                        style={{ ...ui.input, width: 300, maxWidth: 300, minHeight: 60, fontFamily: "inherit" }}
                        value={editMemo}
                        onChange={(e) => setEditMemo(e.target.value)}
                        placeholder="例: 〇〇の資料(https://example.com/...)"
                        maxLength={MEMO_MAX_LENGTH}
                      />
                    ) : (
                      <MemoText memo={r.memo ?? ""} />
                    )}
                  </td>
                  <td style={{ ...ui.td, textAlign: "center" }}>
                    {isEditing && canEdit ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "stretch" }}>
                        <button
                          style={{ ...ui.buttonSmall, fontSize: 11, padding: "2px 6px" }}
                          onClick={() => saveEdit(r.date)}
                          disabled={busy}
                        >
                          保存
                        </button>
                        <button
                          style={{ ...ui.buttonSmall, fontSize: 11, padding: "2px 6px" }}
                          onClick={cancelEdit}
                          disabled={busy}
                        >
                          取消
                        </button>
                      </div>
                    ) : canEdit ? (
                      <button type="button" style={ui.iconButton} onClick={() => startEdit(r)} disabled={busy} title="編集">
                        <EditPencilIcon />
                      </button>
                    ) : null}
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

// メモの表示。「表示名(URL)」と書かれた部分は表示名のリンクに、URLだけの場合はURL自体のリンクにする(新しいタブで開く)。
function MemoText({ memo }: { memo: string }) {
  if (!memo) return <span style={{ color: "#9ca3af" }}>-</span>;
  return (
    <>
      {parseMemo(memo).map((seg, i) =>
        seg.type === "link" ? (
          <a key={i} href={seg.href} target="_blank" rel="noopener noreferrer" style={{ color: "#3f8fb8" }}>
            {seg.text}
          </a>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </>
  );
}
