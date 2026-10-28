"use client";

import { Fragment, useEffect, useState } from "react";
import { formatYen } from "@/lib/format-yen";
import * as ui from "../../ui";
import FilterPanel from "../../FilterPanel";
import { useCanEditReports } from "../../CurrentUserContext";
import { EditPencilIcon } from "../../icons";
import { buildMonthlyDisplayItems, formatMonthLabel, type MonthlyDisplayItem } from "@/lib/monthly-totals";
import { daysAgoJST, todayJST } from "@/lib/csv-client";

type ScenarioDailyReportRow = {
  date: string;
  scenario: string;
  pvCount: number | null;
  impCount: number | null;
  clCount: number | null;
  impRate: number | null;
  clRate: number | null;
  friendCount: number;
  friendAddRate: number | null;
  cvCount: number;
  cvr: number | null;
  billingAmount: number;
};

type Totals = {
  pv: number | null;
  imp: number | null;
  cl: number | null;
  impRate: number | null;
  clRate: number | null;
  friend: number;
  friendAddRate: number | null;
  cv: number;
  cvr: number | null;
  billing: number;
};

// 見出し2段分の高さ(px)。2段目の見出し行をこの分だけ下にずらしてstickyさせる。
const HEADER_ROW_HEIGHT = 30;

export default function DailyReportByScenarioPage() {
  const canEdit = useCanEditReports();
  const [from, setFrom] = useState(daysAgoJST(29));
  const [to, setTo] = useState(todayJST());
  const [rows, setRows] = useState<ScenarioDailyReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");
  const [selectedScenarios, setSelectedScenarios] = useState<Set<string>>(new Set());
  const [activeScenarios, setActiveScenarios] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null); // `${scenario}__${date}`
  const [editPv, setEditPv] = useState("");

  useEffect(() => {
    fetchReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchReport() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/report/daily-by-scenario?from=${from}&to=${to}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "取得に失敗しました");
      const newRows: ScenarioDailyReportRow[] = data.rows ?? [];
      const newActiveScenarios: string[] = data.activeLabels ?? [];
      setRows(newRows);
      setActiveScenarios(new Set(newActiveScenarios));
      // 取得のたびに、その時点で「現在稼働中」のシナリオだけを選択状態にしておく
      // (直近の友だち追加・成果・imp数/CL数取り込みに登場するもの。稼働中が1つも無い場合は全件を選択する)
      const allScenarios = newRows.map((r) => r.scenario);
      const activeSet = new Set(newActiveScenarios);
      const defaultSelected = allScenarios.filter((p) => activeSet.has(p));
      setSelectedScenarios(new Set(defaultSelected.length > 0 ? defaultSelected : allScenarios));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  function toggleScenario(scenario: string) {
    setSelectedScenarios((s) => {
      const next = new Set(s);
      if (next.has(scenario)) next.delete(scenario);
      else next.add(scenario);
      return next;
    });
  }

  function startEdit(row: ScenarioDailyReportRow) {
    setEditingKey(`${row.scenario}__${row.date}`);
    setEditPv(row.pvCount === null ? "" : String(row.pvCount));
  }

  function cancelEdit() {
    setEditingKey(null);
  }

  // 空欄で保存した場合はnullを送って「未入力」の状態に戻す。数値が入っていればその値をそのまま設定する。
  async function saveEdit(row: ScenarioDailyReportRow) {
    const trimmed = editPv.trim();
    const pvCount = trimmed === "" ? null : Number(trimmed);
    if (pvCount !== null && Number.isNaN(pvCount)) {
      alert("PV数は数値で入力してください(空欄も可)");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/report/ad-metrics-by-scenario/${row.date}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario: row.scenario, pvCount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "更新に失敗しました");
      setEditingKey(null);
      await fetchReport();
    } catch (e) {
      alert(`更新に失敗しました: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  function totalsOf(subset: ScenarioDailyReportRow[]): Totals {
    const pv = subset.some((r) => r.pvCount !== null) ? subset.reduce((sum, r) => sum + (r.pvCount ?? 0), 0) : null;
    const imp = subset.some((r) => r.impCount !== null)
      ? subset.reduce((sum, r) => sum + (r.impCount ?? 0), 0)
      : null;
    const cl = subset.some((r) => r.clCount !== null) ? subset.reduce((sum, r) => sum + (r.clCount ?? 0), 0) : null;
    const impRate = imp !== null && pv !== null && pv > 0 ? Math.round((imp / pv) * 1000) / 10 : null;
    const clRate = cl !== null && imp !== null && imp > 0 ? Math.round((cl / imp) * 1000) / 10 : null;
    const friend = subset.reduce((sum, r) => sum + r.friendCount, 0);
    const friendAddRate = cl !== null && cl > 0 ? Math.round((friend / cl) * 1000) / 10 : null;
    const cv = subset.reduce((sum, r) => sum + r.cvCount, 0);
    const billing = subset.reduce((sum, r) => sum + r.billingAmount, 0);
    return { pv, imp, impRate, cl, clRate, friend, friendAddRate, cv, billing, cvr: friend > 0 ? Math.round((cv / friend) * 1000) / 10 : null };
  }

  // シナリオごとにグループ化し、それぞれ月ごとの総計行込みの表示用配列(displayItems)を作る。
  // 日付範囲・並び順はすべてのシナリオで共通のため、どのシナリオの配列も行数・並びが一致する
  // (zip して1つのテーブルにまとめられる)。
  const scenarioOrder = Array.from(new Set(rows.map((r) => r.scenario)));
  const displayItemsByScenario = new Map<string, MonthlyDisplayItem<ScenarioDailyReportRow, Totals>[]>();
  scenarioOrder.forEach((scenario) => {
    const scenarioRows = rows
      .filter((r) => r.scenario === scenario)
      .sort((a, b) => (sortOrder === "asc" ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)));
    displayItemsByScenario.set(scenario, buildMonthlyDisplayItems(scenarioRows, (r) => r.date, sortOrder, totalsOf));
  });

  const visibleScenarios = scenarioOrder.filter((p) => selectedScenarios.has(p));
  // 行の並び(日付・総計行の位置)は全シナリオで共通のため、先頭のシナリオの配列を「行の骨格」として使う
  const referenceItems = displayItemsByScenario.get(scenarioOrder[0]) ?? [];


  function downloadCsv() {
    const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const header = [
      "シナリオ",
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
    ]
      .map(escape)
      .join(",");
    const numOrDash = (v: number | null) => (v === null ? "-" : String(v));
    const lines: string[] = [];
    scenarioOrder.forEach((scenario) => {
      (rows.filter((r) => r.scenario === scenario) ?? []).forEach((r) => {
        lines.push(
          [
            scenario,
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
          ]
            .map(escape)
            .join(",")
        );
      });
    });
    const csv = "﻿" + [header, ...lines].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `日次レポート_シナリオ別_${from}_${to}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <main style={ui.pageWide}>
      <h1 style={ui.h1}>シナリオ別</h1>

      <FilterPanel>
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
      </FilterPanel>

      {error && <p style={{ color: "#c0392b", fontSize: 13 }}>{error}</p>}


      {scenarioOrder.length > 0 && (
        <div style={{ ...ui.section, marginBottom: 20 }}>
          <h2 style={ui.h2}>表示するシナリオ</h2>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <button type="button" style={ui.buttonSmall} onClick={() => setSelectedScenarios(new Set(scenarioOrder))}>
              すべて選択
            </button>
            <button type="button" style={ui.buttonSmall} onClick={() => setSelectedScenarios(new Set())}>
              すべて解除
            </button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px" }}>
            {scenarioOrder.map((scenario) => (
              <label key={scenario} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13.5 }}>
                <input type="checkbox" checked={selectedScenarios.has(scenario)} onChange={() => toggleScenario(scenario)} />
                <span style={activeScenarios.has(scenario) ? ui.activeLabelText : undefined}>{scenario}</span>
                {activeScenarios.has(scenario) && <span style={ui.activeLabelBadge}>稼働中</span>}
              </label>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
        <button type="button" style={ui.buttonSmall} onClick={downloadCsv} disabled={rows.length === 0}>
          CSVダウンロード
        </button>
      </div>

      {scenarioOrder.length === 0 && !loading && <p style={{ fontSize: 13, color: "#6b7280" }}>データがありません</p>}
      {scenarioOrder.length > 0 && selectedScenarios.size === 0 && (
        <p style={{ fontSize: 13, color: "#6b7280" }}>上の一覧から表示するシナリオを選択してください</p>
      )}

      {visibleScenarios.length > 0 && (
        <div style={ui.compareTableScroll}>
          <table style={ui.compareTable}>
            <thead>
              <tr>
                <th rowSpan={2} style={ui.compareDateCornerTh}>
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
                {visibleScenarios.map((scenario) => (
                  <th
                    key={scenario}
                    colSpan={11}
                    style={activeScenarios.has(scenario) ? { ...ui.compareGroupTh, ...ui.activeLabelText } : ui.compareGroupTh}
                  >
                    {scenario}
                    {activeScenarios.has(scenario) && <span style={ui.activeLabelBadge}>稼働中</span>}
                  </th>
                ))}
              </tr>
              <tr>
                {visibleScenarios.map((scenario) => (
                  <Fragment key={scenario}>
                    <th
                      key={`${scenario}__pv`}
                      style={{ ...ui.compareMetricTh, top: HEADER_ROW_HEIGHT, borderLeft: ui.compareGroupDividerBorder }}
                    >
                      PV数
                    </th>
                    <th key={`${scenario}__imp`} style={{ ...ui.compareMetricTh, top: HEADER_ROW_HEIGHT }}>
                      imp数
                    </th>
                    <th key={`${scenario}__impRate`} style={{ ...ui.compareMetricTh, top: HEADER_ROW_HEIGHT }}>
                      imp率
                    </th>
                    <th key={`${scenario}__cl`} style={{ ...ui.compareMetricTh, top: HEADER_ROW_HEIGHT }}>
                      CL数
                    </th>
                    <th key={`${scenario}__clRate`} style={{ ...ui.compareMetricTh, top: HEADER_ROW_HEIGHT }}>
                      CL率
                    </th>
                    <th key={`${scenario}__friend`} style={{ ...ui.compareMetricTh, top: HEADER_ROW_HEIGHT }}>
                      友だち追加
                    </th>
                    <th key={`${scenario}__friendRate`} style={{ ...ui.compareMetricTh, top: HEADER_ROW_HEIGHT }}>
                      追加率
                    </th>
                    <th key={`${scenario}__cv`} style={{ ...ui.compareMetricTh, top: HEADER_ROW_HEIGHT }}>
                      CV数
                    </th>
                    <th key={`${scenario}__cvr`} style={{ ...ui.compareMetricTh, top: HEADER_ROW_HEIGHT }}>
                      CVR
                    </th>
                    <th key={`${scenario}__billing`} style={{ ...ui.compareMetricTh, top: HEADER_ROW_HEIGHT }}>
                      請求額
                    </th>
                    <th
                      key={`${scenario}__edit`}
                      style={{ ...ui.compareMetricTh, top: HEADER_ROW_HEIGHT, width: 32 }}
                    />
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {referenceItems.map((refItem, i) => {
                if (refItem.kind === "total") {
                  return (
                    <tr key={`total-${refItem.monthKey}`}>
                      <td style={{ ...ui.compareDateTd, background: "#eef3f6", fontWeight: 600 }}>
                        {formatMonthLabel(refItem.monthKey)} 合計
                      </td>
                      {visibleScenarios.map((scenario) => {
                        const item = displayItemsByScenario.get(scenario)?.[i];
                        const t = item && item.kind === "total" ? item.totals : totalsOf([]);
                        return (
                          <Fragment key={scenario}>
                            <td
                              key={`${scenario}__pv`}
                              style={{
                                ...ui.compareTd,
                                background: "#eef3f6",
                                fontWeight: 600,
                                borderLeft: ui.compareGroupDividerBorder,
                              }}
                            >
                              {t.pv === null ? "-" : t.pv}
                            </td>
                            <td key={`${scenario}__imp`} style={{ ...ui.compareTd, background: "#eef3f6", fontWeight: 600 }}>
                              {t.imp === null ? "-" : t.imp}
                            </td>
                            <td key={`${scenario}__impRate`} style={{ ...ui.compareTd, background: "#eef3f6", fontWeight: 600 }}>
                              {t.impRate === null ? "-" : `${t.impRate}%`}
                            </td>
                            <td key={`${scenario}__cl`} style={{ ...ui.compareTd, background: "#eef3f6", fontWeight: 600 }}>
                              {t.cl === null ? "-" : t.cl}
                            </td>
                            <td key={`${scenario}__clRate`} style={{ ...ui.compareTd, background: "#eef3f6", fontWeight: 600 }}>
                              {t.clRate === null ? "-" : `${t.clRate}%`}
                            </td>
                            <td key={`${scenario}__friend`} style={{ ...ui.compareTd, background: "#eef3f6", fontWeight: 600 }}>
                              {t.friend}
                            </td>
                            <td
                              key={`${scenario}__friendRate`}
                              style={{ ...ui.compareTd, background: "#eef3f6", fontWeight: 600 }}
                            >
                              {t.friendAddRate === null ? "-" : `${t.friendAddRate}%`}
                            </td>
                            <td key={`${scenario}__cv`} style={{ ...ui.compareTd, background: "#eef3f6", fontWeight: 600 }}>
                              {t.cv}
                            </td>
                            <td key={`${scenario}__cvr`} style={{ ...ui.compareTd, background: "#eef3f6", fontWeight: 600 }}>
                              {t.cvr === null ? "-" : `${t.cvr}%`}
                            </td>
                            <td key={`${scenario}__billing`} style={{ ...ui.compareTd, background: "#eef3f6", fontWeight: 600, whiteSpace: "nowrap" }}>
                              {formatYen(t.billing)}
                            </td>
                            <td key={`${scenario}__edit`} style={{ ...ui.compareTd, background: "#eef3f6" }} />
                          </Fragment>
                        );
                      })}
                    </tr>
                  );
                }

                const date = refItem.row.date;
                return (
                  <tr key={date}>
                    <td style={ui.compareDateTd}>{date}</td>
                    {visibleScenarios.map((scenario) => {
                      const item = displayItemsByScenario.get(scenario)?.[i];
                      const r = item && item.kind === "row" ? item.row : null;
                      if (!r) return null;
                      const key = `${scenario}__${r.date}`;
                      const isEditing = editingKey === key;
                      return (
                        <Fragment key={scenario}>
                          <td key={`${scenario}__pv`} style={{ ...ui.compareTd, borderLeft: ui.compareGroupDividerBorder }}>
                            {isEditing ? (
                              <input
                                type="number"
                                style={{ ...ui.input, width: 70, maxWidth: 70, fontSize: 12.5, padding: "4px 6px" }}
                                value={editPv}
                                onChange={(e) => setEditPv(e.target.value)}
                                placeholder="未入力"
                              />
                            ) : r.pvCount === null ? (
                              "-"
                            ) : (
                              r.pvCount
                            )}
                          </td>
                          <td key={`${scenario}__imp`} style={ui.compareTd}>
                            {r.impCount === null ? "-" : r.impCount}
                          </td>
                          <td key={`${scenario}__impRate`} style={ui.compareTd}>
                            {r.impRate === null ? "-" : `${r.impRate}%`}
                          </td>
                          <td key={`${scenario}__cl`} style={ui.compareTd}>
                            {r.clCount === null ? "-" : r.clCount}
                          </td>
                          <td key={`${scenario}__clRate`} style={ui.compareTd}>
                            {r.clRate === null ? "-" : `${r.clRate}%`}
                          </td>
                          <td key={`${scenario}__friend`} style={ui.compareTd}>
                            {r.friendCount}
                          </td>
                          <td key={`${scenario}__friendRate`} style={ui.compareTd}>
                            {r.friendAddRate === null ? "-" : `${r.friendAddRate}%`}
                          </td>
                          <td key={`${scenario}__cv`} style={ui.compareTd}>
                            {r.cvCount}
                          </td>
                          <td key={`${scenario}__cvr`} style={ui.compareTd}>
                            {r.cvr === null ? "-" : `${r.cvr}%`}
                          </td>
                          <td key={`${scenario}__billing`} style={{ ...ui.compareTd, whiteSpace: "nowrap" }}>
                            {formatYen(r.billingAmount)}
                          </td>
                          <td key={`${scenario}__edit`} style={{ ...ui.compareTd, textAlign: "center" }}>
                            {isEditing && canEdit ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "stretch" }}>
                                <button
                                  style={{ ...ui.buttonSmall, fontSize: 11, padding: "2px 6px" }}
                                  onClick={() => saveEdit(r)}
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
                              <button
                                type="button"
                                style={ui.iconButton}
                                onClick={() => startEdit(r)}
                                disabled={busy}
                                title="編集"
                              >
                                <EditPencilIcon />
                              </button>
                            ) : null}
                          </td>
                        </Fragment>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
