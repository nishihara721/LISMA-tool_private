"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as ui from "../ui";
import MultiSelect from "../MultiSelect";
import Pager from "../Pager";
import { useCanEditReports } from "../CurrentUserContext";

// スプレッドシート出力先の設定。指定しなければGAS側のデフォルト(logTypeという名前のシートに追記)で動作する。
export type SheetWriteMode = "append" | "overwrite" | "cell";

type SheetExportSettings = {
  spreadsheet: string; // スプレッドシートのURLまたはID(空欄ならGAS側でバインドされているスプレッドシートを使う)
  sheetName: string; // シート名(空欄ならlogTypeをそのまま使う)
  writeMode: SheetWriteMode;
  startCell: string; // writeMode が "cell" の場合の左上セル(例: "B3")
};

const DEFAULT_SHEET_SETTINGS: SheetExportSettings = {
  spreadsheet: "",
  sheetName: "",
  writeMode: "append",
  startCell: "A1",
};

function sheetSettingsStorageKey(logType: string) {
  return `lft_sheetExportSettings:${logType}`;
}

// 直前に使った出力先設定をブラウザに覚えさせておく(次回も同じスプレッドシートに送ることが多いため)。
// あくまで入力の手間を省くための補助であり、送信内容そのものはこのコンポーネントの外の`rows`から作る。
function loadSheetSettings(logType: string): SheetExportSettings {
  try {
    const raw = localStorage.getItem(sheetSettingsStorageKey(logType));
    if (!raw) return DEFAULT_SHEET_SETTINGS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SHEET_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SHEET_SETTINGS;
  }
}

function saveSheetSettings(logType: string, settings: SheetExportSettings) {
  try {
    localStorage.setItem(sheetSettingsStorageKey(logType), JSON.stringify(settings));
  } catch {
    // 保存できなくても送信自体には影響させない
  }
}

// 一覧に出す1行分のデータ(サーバーから受け取る。表示用の文字列のみ)
export type TableRowData = { id: string; cells: Record<string, string> };

// render: "code"=等幅表示 / "codeSmall"=小さめの等幅表示 / "level"=レベル(情報・警告・エラー)を色分け
export type Column = { key: string; label: string; render?: "code" | "codeSmall" | "level" };

export type FilterDef =
  | { key: string; label: string; type: "text" }
  | { key: string; label: string; type: "select"; options: string[] }
  | { key: string; label: string; type: "multiselect"; options: string[] } // 複数選択(選んだもののどれかに一致)
  | { key: string; label: string; type: "date"; primary?: boolean }; // primary: 並び順の基準になる日時(期間の絞り込みはサーバー側で範囲指定する)

type FilterState = Record<string, { text: string; values: string[]; from: string; to: string }>;

type PageData = { rows: TableRowData[]; nextCursor: string | null; hasMore: boolean };

type LogTableProps = {
  kind: string; // /api/admin/table に渡す種別
  columns: Column[];
  filters: FilterDef[];
  logType: string; // スプレッドシート送信時のシート識別名に使う(英数字推奨)
  fileNamePrefix: string; // CSVファイル名の接頭辞(日本語可)
  defaultToday?: boolean; // trueなら、開いた時は主たる日時(primary)の期間を「当日」に絞り込む
  noWrap?: boolean; // trueにすると、セルの文字を折り返さず、テーブルが画面に入りきらない場合は横スクロールにする
};

const PAGE_SIZE = 50;
const EXPORT_PAGE_SIZE = 500;
const EXPORT_MAX_ROWS = 10000; // CSV・スプレッドシート出力で一度に取得する件数の上限

const LEVEL_COLOR: Record<string, string> = { 情報: "#4a5568", 警告: "#b7791f", エラー: "#c0392b" };

// 日本時間の今日(YYYY-MM-DD)
function todayJst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function emptyFilterState(defs: FilterDef[], defaultToday: boolean): FilterState {
  const state: FilterState = {};
  defs.forEach((f) => {
    const today = defaultToday && f.type === "date" && f.primary ? todayJst() : "";
    state[f.key] = { text: "", values: [], from: today, to: today };
  });
  return state;
}

function toRequestFilters(state: FilterState) {
  const out: Record<string, { text?: string; values?: string[]; from?: string; to?: string }> = {};
  Object.entries(state).forEach(([key, v]) => {
    if (v.text || v.values.length || v.from || v.to) {
      out[key] = { text: v.text || undefined, values: v.values.length ? v.values : undefined, from: v.from || undefined, to: v.to || undefined };
    }
  });
  return out;
}

function toCsv(columns: Column[], rows: TableRowData[]): string {
  const escape = (v: string) => {
    if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  };
  const header = columns.map((c) => escape(c.label)).join(",");
  const lines = rows.map((r) => columns.map((c) => escape(r.cells[c.key] ?? "")).join(","));
  // 先頭にBOMを付与し、Excelで開いた際の文字化けを防ぐ
  return "\uFEFF" + [header, ...lines].join("\r\n");
}

export default function LogTable({
  kind,
  columns,
  filters,
  logType,
  fileNamePrefix,
  defaultToday = false,
  noWrap = false,
}: LogTableProps) {
  // 閲覧権限のユーザーは、スプレッドシートへの書き込み(送信)はできない(サーバー側でも拒否している)
  const canSendToSheet = useCanEditReports();
  const [filterState, setFilterState] = useState<FilterState>(() => emptyFilterState(filters, defaultToday));
  // テキスト入力のたびに問い合わせないよう、少し待ってから反映した値で取得する
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(filterState);
  const [pages, setPages] = useState<PageData[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const requestSeq = useRef(0);
  const [reloadTick, setReloadTick] = useState(0);

  // 他のコンポーネント(Lステップナンバーの取り込み等)からの再読み込みの依頼
  useEffect(() => {
    const handler = () => setReloadTick((n) => n + 1);
    window.addEventListener("lft:table-reload", handler);
    return () => window.removeEventListener("lft:table-reload", handler);
  }, []);

  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState("");
  const [sheetStatus, setSheetStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [sheetErrorMessage, setSheetErrorMessage] = useState("");
  const [sheetSettingsOpen, setSheetSettingsOpen] = useState(false);
  const [sheetSettings, setSheetSettings] = useState<SheetExportSettings>(DEFAULT_SHEET_SETTINGS);

  // ブラウザに保存済みの出力先設定があれば読み込む(ページ・ログ種別ごとに別々に覚える)
  useEffect(() => {
    setSheetSettings(loadSheetSettings(logType));
  }, [logType]);

  useEffect(() => {
    const t = setTimeout(() => setAppliedFilters(filterState), 1000);
    return () => clearTimeout(t);
  }, [filterState]);

  const fetchPage = useCallback(
    async (cursor: string | null, pageSize: number, state: FilterState) => {
      const res = await fetch("/api/admin/table", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, cursor, pageSize, filters: toRequestFilters(state) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "一覧の取得に失敗しました");
      return data as PageData;
    },
    [kind]
  );

  // 絞り込み条件が変わったら、1ページ目から取得し直す
  useEffect(() => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setLoadError("");
    setPages([]);
    setPageIndex(0);
    fetchPage(null, PAGE_SIZE, appliedFilters)
      .then((page) => {
        if (seq === requestSeq.current) setPages([page]);
      })
      .catch((e) => {
        if (seq === requestSeq.current) setLoadError(String(e.message ?? e));
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false);
      });
  }, [appliedFilters, fetchPage, reloadTick]);

  async function goNext() {
    const current = pages[pageIndex];
    if (!current) return;
    if (pages[pageIndex + 1]) {
      setPageIndex(pageIndex + 1);
      return;
    }
    if (!current.hasMore || loading) return;
    const seq = ++requestSeq.current;
    setLoading(true);
    setLoadError("");
    try {
      const page = await fetchPage(current.nextCursor, PAGE_SIZE, appliedFilters);
      if (seq !== requestSeq.current) return;
      setPages((p) => [...p, page]);
      setPageIndex((i) => i + 1);
    } catch (e) {
      if (seq === requestSeq.current) setLoadError(String((e as Error).message ?? e));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }

  function goPrev() {
    if (pageIndex > 0) setPageIndex(pageIndex - 1);
  }

  const currentPage = pages[pageIndex];
  const rows = currentPage?.rows ?? [];
  const noRows = rows.length === 0;

  const defaultState = emptyFilterState(filters, defaultToday);
  const isDefaultFilter = filters.every((f) => {
    const a = filterState[f.key];
    const d = defaultState[f.key];
    return a && d && a.text === d.text && a.from === d.from && a.to === d.to && a.values.length === 0;
  });

  function patchFilter(key: string, patch: Partial<FilterState[string]>) {
    setFilterState((s) => ({ ...s, [key]: { ...s[key], ...patch } }));
  }

  function clearFilters() {
    setFilterState(emptyFilterState(filters, defaultToday));
  }

  function showAllPeriod() {
    setFilterState((s) => {
      const next = { ...s };
      filters.forEach((f) => {
        if (f.type === "date" && f.primary) next[f.key] = { ...next[f.key], from: "", to: "" };
      });
      return next;
    });
  }

  // CSV・スプレッドシート出力用に、現在の絞り込み条件に合う行を(ページ送りせず)まとめて取得する
  async function fetchAllRows(): Promise<TableRowData[]> {
    const all: TableRowData[] = [];
    let cursor: string | null = null;
    setExportNote("");
    for (;;) {
      const page = await fetchPage(cursor, EXPORT_PAGE_SIZE, appliedFilters);
      all.push(...page.rows);
      if (all.length >= EXPORT_MAX_ROWS) {
        if (page.hasMore) setExportNote(`最大${EXPORT_MAX_ROWS.toLocaleString()}件までを出力しました。期間などで絞り込んでください`);
        return all.slice(0, EXPORT_MAX_ROWS);
      }
      if (!page.hasMore) return all;
      cursor = page.nextCursor;
    }
  }

  async function downloadCsv() {
    setExporting(true);
    try {
      const all = await fetchAllRows();
      const csv = toCsv(columns, all);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileNamePrefix}_${todayJst()}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportNote(`出力に失敗しました: ${(e as Error).message ?? e}`);
    } finally {
      setExporting(false);
    }
  }

  async function sendToSheet() {
    if (sheetSettings.writeMode === "cell" && !sheetSettings.startCell.trim()) {
      setSheetStatus("error");
      setSheetErrorMessage("セル指定を選んだ場合は、開始セル(例: A1)を入力してください");
      return;
    }

    setSheetStatus("sending");
    setSheetErrorMessage("");
    saveSheetSettings(logType, sheetSettings);
    try {
      const all = await fetchAllRows();
      const res = await fetch("/api/logs/export-to-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          logType,
          headers: columns.map((c) => c.label),
          rows: all.map((r) => columns.map((c) => r.cells[c.key] ?? "")),
          spreadsheet: sheetSettings.spreadsheet.trim() || undefined,
          sheetName: sheetSettings.sheetName.trim() || undefined,
          writeMode: sheetSettings.writeMode,
          startCell: sheetSettings.writeMode === "cell" ? sheetSettings.startCell.trim() : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSheetStatus("error");
        setSheetErrorMessage(data.error ?? "送信に失敗しました");
        return;
      }
      setSheetStatus("done");
    } catch {
      setSheetStatus("error");
      setSheetErrorMessage("送信に失敗しました(通信エラー)");
    }
  }

  function renderCell(col: Column, row: TableRowData) {
    const v = row.cells[col.key] ?? "";
    if (col.render === "code" || col.render === "codeSmall") {
      if (!v) return "-";
      return <code style={col.render === "codeSmall" ? { ...ui.code, fontSize: 11.5 } : ui.code}>{v}</code>;
    }
    if (col.render === "level") {
      return <span style={{ color: LEVEL_COLOR[v] ?? "#4a5568", fontWeight: 600 }}>{v}</span>;
    }
    return v === "" ? "-" : v;
  }

  const pager = (
    <Pager
      page={pageIndex + 1}
      totalPages={undefined}
      pageSize={PAGE_SIZE}
      hasPrev={pageIndex > 0}
      hasNext={!!(pages[pageIndex + 1] || currentPage?.hasMore)}
      loading={loading}
      onPrev={goPrev}
      onNext={goNext}
    />
  );

  return (
    <>
      <div style={ui.filterBar}>
        {filters.map((f) => {
          const st = filterState[f.key];
          if (f.type === "text") {
            return (
              <div key={f.key} style={ui.filterField}>
                <label style={ui.filterLabel}>{f.label}</label>
                <input
                  type="text"
                  placeholder="部分一致で検索"
                  style={ui.filterInput}
                  value={st.text}
                  onChange={(e) => patchFilter(f.key, { text: e.target.value })}
                />
              </div>
            );
          }
          if (f.type === "select") {
            return (
              <div key={f.key} style={ui.filterField}>
                <label style={ui.filterLabel}>{f.label}</label>
                <select
                  style={ui.filterSelect}
                  value={st.values[0] ?? ""}
                  onChange={(e) => patchFilter(f.key, { values: e.target.value ? [e.target.value] : [] })}
                >
                  <option value="">すべて</option>
                  {f.options.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            );
          }
          if (f.type === "multiselect") {
            return (
              <div key={f.key} style={ui.filterField}>
                <label style={ui.filterLabel}>{f.label}</label>
                <MultiSelect options={f.options} value={st.values} onChange={(next) => patchFilter(f.key, { values: next })} />
              </div>
            );
          }
          // date
          return (
            <div key={f.key} style={{ display: "flex", gap: 8 }}>
              <div style={ui.filterField}>
                <label style={ui.filterLabel}>{f.label}(開始)</label>
                <input type="date" style={ui.filterInput} value={st.from} onChange={(e) => patchFilter(f.key, { from: e.target.value })} />
              </div>
              <div style={ui.filterField}>
                <label style={ui.filterLabel}>{f.label}(終了)</label>
                <input type="date" style={ui.filterInput} value={st.to} onChange={(e) => patchFilter(f.key, { to: e.target.value })} />
              </div>
            </div>
          );
        })}
        {!isDefaultFilter && (
          <button type="button" style={ui.buttonSmall} onClick={clearFilters}>
            絞り込みをクリア
          </button>
        )}
        {defaultToday && (
          <button type="button" style={ui.buttonSmall} onClick={showAllPeriod}>
            全期間を表示
          </button>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
        <p style={{ ...ui.filterResultCount, margin: 0 }}>{loading ? "読み込み中…" : `${rows.length}件表示`}</p>
        <button type="button" style={ui.buttonSmall} onClick={downloadCsv} disabled={noRows || exporting}>
          {exporting ? "取得中…" : "CSVダウンロード"}
        </button>
        {canSendToSheet && (
          <button
            type="button"
            style={ui.buttonSmall}
            onClick={() => setSheetSettingsOpen((v) => !v)}
            disabled={noRows}
          >
            スプレッドシートに送信{sheetSettingsOpen ? " ▲" : " ▼"}
          </button>
        )}
        {sheetStatus === "done" && <span style={{ fontSize: 12.5, color: "#2f855a" }}>送信しました</span>}
        {sheetStatus === "error" && !sheetSettingsOpen && (
          <span style={{ fontSize: 12.5, color: "#c0392b" }}>{sheetErrorMessage}</span>
        )}
        {exportNote && <span style={{ fontSize: 12.5, color: "#b7791f" }}>{exportNote}</span>}
      </div>

      {canSendToSheet && sheetSettingsOpen && (
        <div
          style={{
            border: "1px solid #d9dee3",
            borderRadius: 8,
            padding: 14,
            marginBottom: 14,
            background: "#f8f9fb",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            maxWidth: 520,
          }}
        >
          <div style={ui.filterField}>
            <label style={ui.filterLabel}>スプレッドシート(URLまたはID・空欄でGAS側の既定を使用)</label>
            <input
              type="text"
              placeholder="https://docs.google.com/spreadsheets/d/xxxxx/edit または xxxxx"
              style={ui.filterInput}
              value={sheetSettings.spreadsheet}
              onChange={(e) => setSheetSettings((s) => ({ ...s, spreadsheet: e.target.value }))}
            />
          </div>
          <div style={ui.filterField}>
            <label style={ui.filterLabel}>シート名(空欄で「{logType}」を使用)</label>
            <input
              type="text"
              placeholder={logType}
              style={ui.filterInput}
              value={sheetSettings.sheetName}
              onChange={(e) => setSheetSettings((s) => ({ ...s, sheetName: e.target.value }))}
            />
          </div>
          <div style={ui.filterField}>
            <label style={ui.filterLabel}>書き込み方法</label>
            <select
              style={ui.filterSelect}
              value={sheetSettings.writeMode}
              onChange={(e) =>
                setSheetSettings((s) => ({ ...s, writeMode: e.target.value as SheetWriteMode }))
              }
            >
              <option value="append">末尾の空白行に追加</option>
              <option value="overwrite">シートを上書き(既存の内容は消去)</option>
              <option value="cell">指定したセルから書き込む</option>
            </select>
          </div>
          {sheetSettings.writeMode === "cell" && (
            <div style={ui.filterField}>
              <label style={ui.filterLabel}>開始セル(左上のセル番地)</label>
              <input
                type="text"
                placeholder="例: A1"
                style={{ ...ui.filterInput, maxWidth: 120 }}
                value={sheetSettings.startCell}
                onChange={(e) => setSheetSettings((s) => ({ ...s, startCell: e.target.value }))}
              />
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              type="button"
              style={ui.buttonSmall}
              onClick={sendToSheet}
              disabled={noRows || sheetStatus === "sending"}
            >
              {sheetStatus === "sending" ? "送信中…" : "この内容で送信"}
            </button>
            {sheetStatus === "error" && <span style={{ fontSize: 12.5, color: "#c0392b" }}>{sheetErrorMessage}</span>}
          </div>
        </div>
      )}

      {loadError && <p style={{ color: "#c0392b", fontSize: 13 }}>{loadError}</p>}

      <div style={noWrap ? { ...ui.tableScroll, overflowX: "auto" } : ui.tableScroll}>
        <table style={ui.table} className="admin-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key} style={ui.th}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                {columns.map((col) => (
                  <td key={col.key} style={noWrap ? { ...ui.td, whiteSpace: "nowrap" } : ui.td}>
                    {renderCell(col, row)}
                  </td>
                ))}
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td style={ui.td} colSpan={columns.length}>
                  該当するデータがありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pager}
    </>
  );
}
