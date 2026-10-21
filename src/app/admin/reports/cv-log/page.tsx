"use client";

import { useEffect, useMemo, useState } from "react";
import * as ui from "../../ui";
import MultiSelect from "../../MultiSelect";
import Pager from "../../Pager";
import { SPREADSHEET_ACCEPT, daysAgoJST, parseJstDateTime, parseSpreadsheetFile, todayJST } from "@/lib/csv-client";

type CvLogRow = {
  id: string;
  kind: "auto" | "import";
  hidden: boolean;
  convertedAt: number;
  friendName?: string;
  sourceName?: string;
  purchaseLinkName?: string;
  note?: string;
};

export default function CvLogEditPage() {
  const [from, setFrom] = useState(daysAgoJST(29));
  const [to, setTo] = useState(todayJST());
  const [rows, setRows] = useState<CvLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [importResultMessage, setImportResultMessage] = useState("");
  const [hideCsvResultMessage, setHideCsvResultMessage] = useState("");

  // 成果ログ(通常の成果ログ画面)と同じ考え方の絞り込み(日時・テキスト・プルダウン)。
  // 期間(from/to)は取得する日付範囲そのものを絞り込むのに対し、こちらは取得済みの一覧をさらに絞り込む。
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterFriendName, setFilterFriendName] = useState("");
  const [filterSource, setFilterSource] = useState<string[]>([]);
  const [filterPurchaseLink, setFilterPurchaseLink] = useState<string[]>([]);
  const [filterKind, setFilterKind] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  useEffect(() => {
    fetchRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchRows() {
    setLoading(true);
    setError("");
    setSelected(new Set());
    try {
      const res = await fetch(`/api/report/cv-log?from=${from}&to=${to}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "取得に失敗しました");
      setRows(data.rows ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  const rowMap = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  const kindLabel = (r: CvLogRow) => (r.kind === "import" ? "インポート" : "-");
  const statusLabel = (r: CvLogRow) => (r.hidden ? "非表示" : "表示中");

  const sourceOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.sourceName).filter((v): v is string => !!v))).sort(),
    [rows]
  );
  const purchaseLinkOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.purchaseLinkName).filter((v): v is string => !!v))).sort(),
    [rows]
  );

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (filterDateFrom && r.convertedAt < new Date(`${filterDateFrom}T00:00:00`).getTime()) return false;
      if (filterDateTo && r.convertedAt > new Date(`${filterDateTo}T23:59:59.999`).getTime()) return false;
      if (filterFriendName && !(r.friendName ?? "").toLowerCase().includes(filterFriendName.toLowerCase())) return false;
      if (filterSource.length > 0 && !filterSource.includes(r.sourceName ?? "")) return false;
      if (filterPurchaseLink.length > 0 && !filterPurchaseLink.includes(r.purchaseLinkName ?? "")) return false;
      if (filterKind && kindLabel(r) !== filterKind) return false;
      if (filterStatus && statusLabel(r) !== filterStatus) return false;
      return true;
    });
  }, [rows, filterDateFrom, filterDateTo, filterFriendName, filterSource, filterPurchaseLink, filterKind, filterStatus]);

  // 50件ずつ表示する(絞り込み条件や取得結果が変わったら1ページ目に戻す)
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [filteredRows]);
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const pageRows = filteredRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const hasColumnFilter =
    !!filterDateFrom ||
    !!filterDateTo ||
    !!filterFriendName ||
    filterSource.length > 0 ||
    filterPurchaseLink.length > 0 ||
    !!filterKind ||
    !!filterStatus;

  function clearColumnFilters() {
    setFilterDateFrom("");
    setFilterDateTo("");
    setFilterFriendName("");
    setFilterSource([]);
    setFilterPurchaseLink([]);
    setFilterKind("");
    setFilterStatus("");
  }

  function toggleSelect(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((s) =>
      pageRows.length > 0 && pageRows.every((r) => s.has(r.id)) ? new Set() : new Set(pageRows.map((r) => r.id))
    );
  }

  async function setHidden(ids: string[], hidden: boolean) {
    const items = ids
      .map((id) => rowMap.get(id))
      .filter((r): r is CvLogRow => !!r)
      .map((r) => ({ id: r.id, kind: r.kind, convertedAt: r.convertedAt }));
    if (items.length === 0) return { updated: 0 };

    const res = await fetch("/api/report/cv/visibility", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hidden, items }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "更新に失敗しました");
    return data as { updated: number };
  }

  async function handleBulkHide(hidden: boolean) {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      await setHidden(Array.from(selected), hidden);
      await fetchRows();
    } catch (e) {
      alert(`更新に失敗しました: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleRowToggle(row: CvLogRow) {
    setBusy(true);
    try {
      await setHidden([row.id], !row.hidden);
      await fetchRows();
    } catch (e) {
      alert(`更新に失敗しました: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  // CSVで新しい成果を追加する。列: 成果日時(YYYY/MM/DD または YYYY/MM/DD HH:mm), メモ, 流入経路名, 広告名
  // 1行目が見出し行(「成果日時」等)の場合は自動でスキップする。
  async function handleImportFile(file: File) {
    setBusy(true);
    setImportResultMessage("");
    try {
      const csvRows = await parseSpreadsheetFile(file);
      // 1行目の1列目が日付として解釈できなければ、見出し行とみなして読み飛ばす
      const dataRows = parseJstDateTime(csvRows[0]?.[0] ?? "") === null ? csvRows.slice(1) : csvRows;
      const rowsToImport = dataRows
        .map((r) => ({
          convertedAt: parseJstDateTime(r[0] ?? ""),
          note: r[1]?.trim() || undefined,
          sourceName: r[2]?.trim() || undefined,
          purchaseLinkName: r[3]?.trim() || undefined,
        }))
        .filter((r) => r.convertedAt !== null)
        .map((r) => ({ ...r, convertedAt: r.convertedAt as number }));

      if (rowsToImport.length === 0) {
        setImportResultMessage("有効な行が見つかりませんでした(1列目は「YYYY/MM/DD」または「YYYY/MM/DD HH:mm」形式で入力してください)");
        return;
      }

      const res = await fetch("/api/report/cv/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: rowsToImport }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "取り込みに失敗しました");
      setImportResultMessage(`${data.imported}件を追加しました`);
      await fetchRows();
    } catch (e) {
      setImportResultMessage(`取り込みに失敗しました: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  // CSVで指定したIDの成果を非表示にする。列: ID(現在表示中の一覧のID列と同じ値)
  // 現在の画面に表示されている(=指定した期間内の)行の中からのみマッチさせる。
  async function handleHideCsvFile(file: File) {
    setBusy(true);
    setHideCsvResultMessage("");
    try {
      const csvRows = await parseSpreadsheetFile(file);
      const ids = csvRows
        .map((r) => r[0]?.trim())
        .filter((v): v is string => !!v && v !== "ID" && v !== "id");

      const matchedIds = ids.filter((id) => rowMap.has(id));
      if (matchedIds.length === 0) {
        setHideCsvResultMessage("表示中の期間内で一致するIDが見つかりませんでした(期間を広げてから再度お試しください)");
        return;
      }

      const result = await setHidden(matchedIds, true);
      setHideCsvResultMessage(`${result.updated}件を非表示にしました(${ids.length - matchedIds.length}件は一致せずスキップ)`);
      await fetchRows();
    } catch (e) {
      setHideCsvResultMessage(`非表示処理に失敗しました: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  function downloadSampleImportCsv() {
    const todaySlash = todayJST().replaceAll("-", "/");
    const header = ["成果日時", "メモ", "流入経路名", "広告名"];
    const sampleRows = [
      [todaySlash, "決済代行サービスの管理画面より手動追加", "Instagram広告A", "夏キャンペーンA商品"],
      [`${todaySlash} 13:30`, "", "", ""],
    ];
    const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const csv =
      "﻿" + [header, ...sampleRows].map((r) => r.map(escape).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "成果追加用サンプル.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <main style={ui.pageWide}>
      <h1 style={ui.h1}>編集用成果ログ</h1>

      <div style={ui.filterBar}>
        <div style={ui.filterField}>
          <label style={ui.filterLabel}>期間(開始)</label>
          <input type="date" style={ui.filterInput} value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div style={ui.filterField}>
          <label style={ui.filterLabel}>期間(終了)</label>
          <input type="date" style={ui.filterInput} value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <button type="button" style={ui.buttonPrimary} onClick={fetchRows} disabled={loading}>
          {loading ? "取得中…" : "表示"}
        </button>
      </div>

      {error && <p style={{ color: "#c0392b", fontSize: 13 }}>{error}</p>}

      <div style={{ ...ui.section, marginBottom: 20 }}>
        <h2 style={ui.h2}>CSV/Excelで追加・非表示にする</h2>
        <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
          <div>
            <p style={{ fontSize: 13.5, fontWeight: 600, margin: "0 0 8px" }}>追加</p>
            <button type="button" style={{ ...ui.buttonSmall, marginBottom: 8 }} onClick={downloadSampleImportCsv}>
              サンプルCSVをダウンロード
            </button>
            <br />
            <input
              type="file"
              accept={SPREADSHEET_ACCEPT}
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImportFile(file);
                e.target.value = "";
              }}
            />
            {importResultMessage && <p style={{ fontSize: 12.5, marginTop: 6 }}>{importResultMessage}</p>}
          </div>
          <div>
            <p style={{ fontSize: 13.5, fontWeight: 600, margin: "0 0 8px" }}>非表示</p>
            <input
              type="file"
              accept={SPREADSHEET_ACCEPT}
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleHideCsvFile(file);
                e.target.value = "";
              }}
            />
            {hideCsvResultMessage && <p style={{ fontSize: 12.5, marginTop: 6 }}>{hideCsvResultMessage}</p>}
          </div>
        </div>
      </div>

      <div style={ui.filterBar}>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={ui.filterField}>
            <label style={ui.filterLabel}>成果日時(開始)</label>
            <input
              type="date"
              style={ui.filterInput}
              value={filterDateFrom}
              onChange={(e) => setFilterDateFrom(e.target.value)}
            />
          </div>
          <div style={ui.filterField}>
            <label style={ui.filterLabel}>成果日時(終了)</label>
            <input
              type="date"
              style={ui.filterInput}
              value={filterDateTo}
              onChange={(e) => setFilterDateTo(e.target.value)}
            />
          </div>
        </div>
        <div style={ui.filterField}>
          <label style={ui.filterLabel}>友だち名</label>
          <input
            type="text"
            placeholder="部分一致で検索"
            style={ui.filterInput}
            value={filterFriendName}
            onChange={(e) => setFilterFriendName(e.target.value)}
          />
        </div>
        <div style={ui.filterField}>
          <label style={ui.filterLabel}>流入経路</label>
          <MultiSelect options={sourceOptions} value={filterSource} onChange={setFilterSource} />
        </div>
        <div style={ui.filterField}>
          <label style={ui.filterLabel}>広告</label>
          <MultiSelect options={purchaseLinkOptions} value={filterPurchaseLink} onChange={setFilterPurchaseLink} />
        </div>
        <div style={ui.filterField}>
          <label style={ui.filterLabel}>種別</label>
          <select style={ui.filterSelect} value={filterKind} onChange={(e) => setFilterKind(e.target.value)}>
            <option value="">すべて</option>
            <option value="インポート">インポート</option>
            <option value="-">自動計測</option>
          </select>
        </div>
        <div style={ui.filterField}>
          <label style={ui.filterLabel}>状態</label>
          <select style={ui.filterSelect} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="">すべて</option>
            <option value="表示中">表示中</option>
            <option value="非表示">非表示</option>
          </select>
        </div>
        {hasColumnFilter && (
          <button type="button" style={ui.buttonSmall} onClick={clearColumnFilters}>
            絞り込みをクリア
          </button>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
        <p style={{ ...ui.filterResultCount, margin: 0 }}>
          {filteredRows.length}件表示{hasColumnFilter && ` (全${rows.length}件中)`}
        </p>
        <button type="button" style={ui.buttonSmall} onClick={() => handleBulkHide(true)} disabled={selected.size === 0 || busy}>
          選択した行を非表示にする
        </button>
        <button type="button" style={ui.buttonSmall} onClick={() => handleBulkHide(false)} disabled={selected.size === 0 || busy}>
          選択した行を表示に戻す
        </button>
      </div>

      <div style={{ ...ui.tableScroll, overflowX: "auto" }}>
        <table style={ui.table} className="admin-table">
          <thead>
            <tr>
              <th style={{ ...ui.th, width: 32 }}>
                <input
                  type="checkbox"
                  checked={pageRows.length > 0 && pageRows.every((r) => selected.has(r.id))}
                  onChange={toggleSelectAll}
                />
              </th>
              <th style={ui.th}>成果日時</th>
              <th style={ui.th}>友だち名</th>
              <th style={ui.th}>流入経路</th>
              <th style={ui.th}>広告</th>
              <th style={ui.th}>メモ</th>
              <th style={ui.th}>種別</th>
              <th style={ui.th}>状態</th>
              <th style={ui.th}>ID</th>
              <th style={{ ...ui.th, width: 48 }} />
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr key={r.id} style={r.hidden ? { opacity: 0.55 } : undefined}>
                <td style={{ ...ui.td, whiteSpace: "nowrap" }}>
                  <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} />
                </td>
                <td style={{ ...ui.td, whiteSpace: "nowrap" }}>{new Date(r.convertedAt).toLocaleString("ja-JP")}</td>
                <td style={{ ...ui.td, whiteSpace: "nowrap" }}>{r.friendName ?? "-"}</td>
                <td style={{ ...ui.td, whiteSpace: "nowrap" }}>{r.sourceName ?? "-"}</td>
                <td style={{ ...ui.td, whiteSpace: "nowrap" }}>{r.purchaseLinkName ?? "-"}</td>
                <td style={{ ...ui.td, whiteSpace: "nowrap" }}>{r.note ?? "-"}</td>
                <td style={{ ...ui.td, whiteSpace: "nowrap" }}>
                  {r.kind === "import" ? (
                    <span style={{ color: "#3f8fb8", fontWeight: 600 }}>インポート</span>
                  ) : (
                    "-"
                  )}
                </td>
                <td style={{ ...ui.td, whiteSpace: "nowrap" }}>
                  {r.hidden ? <span style={{ color: "#c0392b", fontWeight: 600 }}>非表示</span> : "表示中"}
                </td>
                <td style={{ ...ui.td, whiteSpace: "nowrap" }}>
                  <code style={ui.code}>{r.id}</code>
                </td>
                <td style={{ ...ui.td, whiteSpace: "nowrap" }}>
                  <button type="button" style={ui.buttonSmall} onClick={() => handleRowToggle(r)} disabled={busy}>
                    {r.hidden ? "表示に戻す" : "非表示にする"}
                  </button>
                </td>
              </tr>
            ))}
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
