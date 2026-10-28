"use client";

import { useEffect, useState } from "react";
import { formatYen } from "@/lib/format-yen";
import * as ui from "../../ui";
import FilterPanel from "../../FilterPanel";
import { currentMonthJST, monthsAgoJST } from "@/lib/csv-client";
import { formatMonthLabel } from "@/lib/monthly-totals";

type MonthlyReportRow = {
  month: string;
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
};

export default function MonthlyReportView({ modeSwitch }: { modeSwitch?: React.ReactNode }) {
  const [fromMonth, setFromMonth] = useState(monthsAgoJST(5));
  const [toMonth, setToMonth] = useState(currentMonthJST());
  const [rows, setRows] = useState<MonthlyReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");

  useEffect(() => {
    fetchReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchReport() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/report/monthly?fromMonth=${fromMonth}&toMonth=${toMonth}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "取得に失敗しました");
      setRows(data.rows ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  const sortedRows = [...rows].sort((a, b) =>
    sortOrder === "asc" ? a.month.localeCompare(b.month) : b.month.localeCompare(a.month)
  );


  function downloadCsv() {
    const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const header = [
      "月",
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
    ]
      .map(escape)
      .join(",");
    const numOrDash = (v: number | null) => (v === null ? "-" : String(v));
    const lines = sortedRows.map((r) =>
      [
        formatMonthLabel(r.month),
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
      ]
        .map(escape)
        .join(",")
    );
    const csv = "﻿" + [header, ...lines].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `月次レポート_${fromMonth}_${toMonth}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <main style={ui.pageWide}>
      <h1 style={ui.h1}>日次・月次レポート</h1>
      {modeSwitch}

      <FilterPanel>
        <div style={ui.filterField}>
          <label style={ui.filterLabel}>期間(開始月)</label>
          <input type="month" style={ui.filterInput} value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} />
        </div>
        <div style={ui.filterField}>
          <label style={ui.filterLabel}>期間(終了月)</label>
          <input type="month" style={ui.filterInput} value={toMonth} onChange={(e) => setToMonth(e.target.value)} />
        </div>
        <button type="button" style={ui.buttonPrimary} onClick={fetchReport} disabled={loading}>
          {loading ? "取得中…" : "表示"}
        </button>
      </FilterPanel>

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
                  title="クリックで月の並び順を切り替え"
                >
                  月 {sortOrder === "asc" ? "▲" : "▼"}
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
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((r) => (
              <tr key={r.month}>
                <td style={ui.td}>{formatMonthLabel(r.month)}</td>
                <td style={ui.td}>{r.pvCount === null ? "-" : r.pvCount}</td>
                <td style={ui.td}>{r.impCount === null ? "-" : r.impCount}</td>
                <td style={ui.td}>{r.impRate === null ? "-" : `${r.impRate}%`}</td>
                <td style={ui.td}>{r.clCount === null ? "-" : r.clCount}</td>
                <td style={ui.td}>{r.clRate === null ? "-" : `${r.clRate}%`}</td>
                <td style={ui.td}>{r.friendCount}</td>
                <td style={ui.td}>{r.friendAddRate === null ? "-" : `${r.friendAddRate}%`}</td>
                <td style={ui.td}>{r.cvCount}</td>
                <td style={ui.td}>{r.cvr === null ? "-" : `${r.cvr}%`}</td>
                <td style={{ ...ui.td, textAlign: "right", whiteSpace: "nowrap" }}>{formatYen(r.billingAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
