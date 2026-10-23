"use client";

import { useState } from "react";
import * as ui from "../../ui";
import { CSV_ACCEPT, parseJstDateTime, parseCsvFile } from "@/lib/csv-client";

// 編集用成果ログの上部に置く、CSVでの成果の追加・非表示のパネル(普段は閉じておく)。
// 閉じている間も入力途中の状態は保持するため、非表示にするだけで作り直さない。
export default function CvLogToolsPanel() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importResultMessage, setImportResultMessage] = useState("");
  const [hideCsvResultMessage, setHideCsvResultMessage] = useState("");

  const reloadTable = () => window.dispatchEvent(new Event("lft:table-reload"));

  // CSVで新しい成果を追加する。列: 成果日時(YYYY/MM/DD または YYYY/MM/DD HH:mm), メモ, 流入経路名, 広告名
  // 1行目が見出し行(「成果日時」等)の場合は自動でスキップする。
  async function handleImportFile(file: File) {
    setBusy(true);
    setImportResultMessage("");
    try {
      const csvRows = await parseCsvFile(file);
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
      reloadTable();
    } catch (e) {
      setImportResultMessage(`取り込みに失敗しました: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  // CSVで指定したIDの成果を非表示にする。列: ID(一覧の「ID」列と同じ値)。期間を問わず、存在するIDならすべて対象
  async function handleHideCsvFile(file: File) {
    setBusy(true);
    setHideCsvResultMessage("");
    try {
      const csvRows = await parseCsvFile(file);
      const ids = csvRows
        .map((r) => r[0]?.trim())
        .filter((v): v is string => !!v && v !== "ID" && v !== "id");
      if (ids.length === 0) {
        setHideCsvResultMessage("IDが見つかりませんでした(1列目にIDを入力してください)");
        return;
      }
      const res = await fetch("/api/report/cv/visibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden: true, ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "更新に失敗しました");
      setHideCsvResultMessage(`${data.updated}件を非表示にしました(${data.notFound}件は一致せずスキップ)`);
      reloadTable();
    } catch (e) {
      setHideCsvResultMessage(`非表示処理に失敗しました: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{ ...ui.buttonSmall, display: "inline-flex", alignItems: "center", gap: 6 }}
      >
        <span aria-hidden>{open ? "▼" : "▶"}</span>
        CSVで追加・非表示にする
      </button>
      <div style={{ display: open ? "block" : "none", marginTop: 12 }}>
        <div style={{ ...ui.section, marginBottom: 20 }}>
          <h2 style={ui.h2}>CSVで追加・非表示にする</h2>
          <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
            <div>
              <p style={{ fontSize: 13.5, fontWeight: 600, margin: "0 0 8px" }}>追加</p>
              <input
                type="file"
                accept={CSV_ACCEPT}
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
                accept={CSV_ACCEPT}
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
      </div>
    </div>
  );
}
