"use client";

import { useState } from "react";
import * as ui from "../../ui";
import { currentMonthJST, monthsAgoJST } from "@/lib/csv-client";
import { formatMonthLabel } from "@/lib/monthly-totals";
import { formatYen } from "@/lib/format-yen";
import { summarizeAdFunnelRows } from "@/lib/ad-funnel-summary";

// 月次サマリ: ポップアップ別・ポップアップ×シナリオ別・設置先×訴求×離脱地点×ポップアップ×シナリオ×中間別の
// 3つの月次集計を1ページに上から順に並べる。表示の仕方は「期間合計」(指定した期間全体の合算)か
// 「特定の月」(1か月分のみ)のどちらかを選ぶ。縦に並べるのは、表示した範囲で稼働した
// (imp数・CL数・友だち追加・CVのいずれかが1件以上ある)ものだけ。閲覧専用。

type ApiRow = {
  month: string;
  pvCount: number | null;
  impCount: number | null;
  clCount: number | null;
  clRate: number | null;
  friendCount: number;
  friendAddRate: number | null;
  cvCount: number;
  cvr: number | null;
  billingAmount: number;
  [key: string]: unknown;
};

type SectionDef = {
  key: string;
  title: string;
  field: string; // APIの各行で名前が入っているフィールド名
  header: string; // 表の左端の見出し
  csvName: string;
};

const SECTIONS: SectionDef[] = [
  {
    key: "monthly",
    title: "月別合計",
    field: "month",
    header: "月",
    csvName: "月別合計",
  },
  {
    key: "popup",
    title: "ポップアップ別",
    field: "label",
    header: "ポップアップ",
    csvName: "ポップアップ別",
  },
  {
    key: "popup-scenario",
    title: "ポップアップ×シナリオ別",
    field: "label",
    header: "ポップアップ / シナリオ",
    csvName: "ポップアップ×シナリオ別",
  },
  {
    key: "source",
    title: "設置先×訴求×離脱地点×ポップアップ×シナリオ×中間別",
    field: "label",
    header: "流入経路の名前",
    csvName: "流入経路別",
  },
];

const METRIC_HEADERS = ["PV数", "imp数", "CL数", "CL率", "友だち追加", "追加率", "CV数", "CVR", "請求額"];
const num = (v: number | null) => (v === null ? "-" : String(v));
const pct = (v: number | null) => (v === null ? "-" : `${v}%`);

type TotalRow = {
  name: string;
  pv: number | null;
  imp: number | null;
  cl: number | null;
  clRate: number | null;
  friend: number;
  friendAddRate: number | null;
  cv: number;
  cvr: number | null;
  billing: number;
  isTotal?: boolean; // 期間全体の合計行(太字で表示)
};

// 名前ごとに、取得した全月の行を合算し、稼働したもの(PV数以外の指標のいずれかが1以上)だけを返す。
// PV数は、組み合わせごとの取り込みが無い場合は日次の合計PV数がそのまま入るため、稼働の判定には使わない。
function buildTotals(rows: ApiRow[], field: string): TotalRow[] {
  const names = Array.from(new Set(rows.map((r) => String(r[field]))));
  const result: TotalRow[] = [];
  names.forEach((name) => {
    const own = rows.filter((r) => String(r[field]) === name);
    const t = summarizeAdFunnelRows(own);
    if ((t.imp ?? 0) > 0 || (t.cl ?? 0) > 0 || t.friend > 0 || t.cv > 0) {
      result.push({ name, pv: t.pv, imp: t.imp, cl: t.cl, clRate: t.clRate, friend: t.friend, friendAddRate: t.friendAddRate, cv: t.cv, cvr: t.cvr, billing: t.billing });
    }
  });
  return result;
}

// 月別合計: 稼働の有無に関わらず表示期間の全ての月を並べ、複数月の場合は最下行に期間全体の合計を付ける
function buildMonthlyTotals(rows: ApiRow[]): TotalRow[] {
  const toRow = (name: string, t: ReturnType<typeof summarizeAdFunnelRows>, isTotal = false): TotalRow => ({
    name, pv: t.pv, imp: t.imp, cl: t.cl, clRate: t.clRate, friend: t.friend, friendAddRate: t.friendAddRate, cv: t.cv, cvr: t.cvr, billing: t.billing, isTotal,
  });
  const result = rows.map((r) => toRow(formatMonthLabel(r.month), summarizeAdFunnelRows([r])));
  if (rows.length > 1) result.push(toRow("合計", summarizeAdFunnelRows(rows), true));
  return result;
}

function cells(r: TotalRow): string[] {
  return [num(r.pv), num(r.imp), num(r.cl), pct(r.clRate), String(r.friend), pct(r.friendAddRate), String(r.cv), pct(r.cvr), formatYen(r.billing)];
}

export default function MonthlySummaryPage() {
  const [scope, setScope] = useState<"total" | "month">("total");
  const [fromMonth, setFromMonth] = useState(monthsAgoJST(5));
  const [toMonth, setToMonth] = useState(currentMonthJST());
  const [singleMonth, setSingleMonth] = useState(currentMonthJST());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [shownLabel, setShownLabel] = useState("");
  const [data, setData] = useState<Record<string, TotalRow[]>>({});
  const [loaded, setLoaded] = useState(false);

  async function fetchReport() {
    setLoading(true);
    setError("");
    const from = scope === "total" ? fromMonth : singleMonth;
    const to = scope === "total" ? toMonth : singleMonth;
    try {
      // 3つの集計を1回の問い合わせでまとめて取得する
      const res = await fetch(`/api/report/monthly-summary?fromMonth=${from}&toMonth=${to}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "取得に失敗しました");
      const results = SECTIONS.map((sec) => [sec.key, (sec.key === "monthly" ? buildMonthlyTotals((json.monthly ?? []) as ApiRow[]) : buildTotals((json[sec.key] ?? []) as ApiRow[], sec.field))] as const);
      setData(Object.fromEntries(results));
      setShownLabel(scope === "total" ? `${formatMonthLabel(fromMonth)}〜${formatMonthLabel(toMonth)}の合計` : `${formatMonthLabel(singleMonth)}`);
      setLoaded(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  function downloadCsv(sec: SectionDef) {
    const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const header = [sec.header, "PV数", "imp数", "CL数", "CL率(%)", "友だち追加数", "友だち追加率(%)", "CV数", "CVR(%)", "請求額(円)"].map(escape).join(",");
    const plain = (v: number | null) => (v === null ? "-" : String(v));
    const lines = (data[sec.key] ?? []).map((r) =>
      [r.name, plain(r.pv), plain(r.imp), plain(r.cl), plain(r.clRate), String(r.friend), plain(r.friendAddRate), String(r.cv), plain(r.cvr), String(r.billing)]
        .map(escape)
        .join(",")
    );
    const csv = "﻿" + [header, ...lines].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `サマリ_${sec.csvName}_${shownLabel.replace(/[〜]/g, "-")}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const radio = (value: "total" | "month", label: string) => (
    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 14 }}>
      <input type="radio" name="summary-scope" value={value} checked={scope === value} onChange={() => setScope(value)} />
      {label}
    </label>
  );

  return (
    <main style={ui.pageWide}>
      <h1 style={ui.h1}>サマリ</h1>

      <div style={{ ...ui.filterBar, alignItems: "flex-end" }}>
        <div style={ui.filterField}>
          <label style={ui.filterLabel}>表示する範囲</label>
          <div role="radiogroup" aria-label="表示する範囲" style={{ display: "flex", gap: 18, height: 34, alignItems: "center" }}>
            {radio("total", "期間合計")}
            {radio("month", "特定の月")}
          </div>
        </div>
        {scope === "total" ? (
          <>
            <div style={ui.filterField}>
              <label style={ui.filterLabel}>期間(開始月)</label>
              <input type="month" style={ui.filterInput} value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} />
            </div>
            <div style={ui.filterField}>
              <label style={ui.filterLabel}>期間(終了月)</label>
              <input type="month" style={ui.filterInput} value={toMonth} onChange={(e) => setToMonth(e.target.value)} />
            </div>
          </>
        ) : (
          <div style={ui.filterField}>
            <label style={ui.filterLabel}>対象月</label>
            <input type="month" style={ui.filterInput} value={singleMonth} onChange={(e) => setSingleMonth(e.target.value)} />
          </div>
        )}
        <button type="button" style={ui.buttonPrimary} onClick={fetchReport} disabled={loading}>
          {loading ? "取得中…" : "表示"}
        </button>
      </div>

      {error && <p style={{ color: "#c0392b", fontSize: 13 }}>{error}</p>}
      {!loaded && !loading && <p style={{ fontSize: 13, color: "#6b7280" }}>範囲を選んで「表示」を押してください</p>}

      {loaded &&
        SECTIONS.map((sec) => {
          const items = data[sec.key] ?? [];
          return (
            <section key={sec.key} style={{ marginBottom: 30 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
                <h2 style={{ ...ui.h2, margin: 0 }}>{sec.title}</h2>
                <button type="button" style={ui.buttonSmall} onClick={() => downloadCsv(sec)} disabled={items.length === 0}>
                  CSVダウンロード
                </button>
              </div>
              {items.length === 0 ? (
                <p style={{ fontSize: 13, color: "#6b7280" }}>この範囲に稼働したデータがありません</p>
              ) : (
                <div style={{ ...ui.tableScroll, maxHeight: "none", overflowX: "auto" }}>
                  <table style={{ ...ui.compareTable, width: "100%" }}>
                    <thead>
                      <tr>
                        <th style={{ ...ui.th, position: "static", whiteSpace: "nowrap" }}>{sec.header}</th>
                        {METRIC_HEADERS.map((h) => (
                          <th key={h} style={{ ...ui.th, position: "static", textAlign: "right", whiteSpace: "nowrap" }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((r) => (
                        <tr key={r.name} style={r.isTotal ? { fontWeight: 700, background: "#f3f6f8" } : undefined}>
                          <td style={{ ...ui.compareTd, textAlign: "left", whiteSpace: "nowrap" }}>{r.name}</td>
                          {cells(r).map((c, i) => (
                            <td key={i} style={{ ...ui.compareTd, whiteSpace: "nowrap" }}>
                              {c}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}
    </main>
  );
}
