"use client";

import { useState } from "react";
import * as ui from "../ui";
import { CSV_ACCEPT, parseCsvFile } from "@/lib/csv-client";

// 広告の一括登録(CSVの取り込み)。
// 列の並び: シナリオ、通数、その他、成果単価、遷移先URL、LIFF ID
// (1行目が見出し行の場合は読み飛ばす。名前は構成要素から自動生成する)
const KEYS = ["scenario", "messageCount", "other", "unitPrice", "destinationUrl", "liffId"] as const;
const MAX_ROWS = 1000;

type Row = Partial<Record<(typeof KEYS)[number], string>>;
type Summary = { total: number; create: number; duplicate: number; empty: number; invalidNumber: number; invalidUrl: number };

export default function PurchaseLinkImportPanel({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function handleSelectFile(file: File) {
    setBusy(true);
    setRows(null);
    setSummary(null);
    setMessage("");
    setError("");
    try {
      let table = await parseCsvFile(file);
      // 1行目が見出し行(「シナリオ」)なら読み飛ばす
      if (table.length > 0 && (table[0][0] ?? "").replace(/\s/g, "") === "シナリオ") table = table.slice(1);
      const parsed: Row[] = table
        .map((r) => Object.fromEntries(KEYS.map((k, i) => [k, (r[i] ?? "").trim()])) as Row)
        .filter((r) => KEYS.some((k) => r[k]));
      if (parsed.length === 0) {
        setError("有効な行が見つかりませんでした");
        return;
      }
      if (parsed.length > MAX_ROWS) {
        setError(`行数が多すぎます(${parsed.length}行)。1回につき${MAX_ROWS}行以下になるよう、分けて取り込んでください`);
        return;
      }
      const res = await fetch("/api/purchase-links/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: parsed, check: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "確認に失敗しました");
      setRows(parsed);
      setFileName(file.name);
      setSummary(data);
    } catch (e) {
      setError(`読み込みに失敗しました: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleExecute() {
    if (!rows) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await fetch("/api/purchase-links/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "登録に失敗しました");
      setMessage(`登録できた件数：${data.create}件 / 登録済み・重複でスキップ：${data.duplicate}件${skipNote(data)}`);
      setRows(null);
      setSummary(null);
      onImported();
    } catch (e) {
      setError(`登録に失敗しました: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  // 一覧が見えにくくならないよう、普段は閉じておく(閉じている間も入力途中の状態は保持するため、非表示にするだけ)
  return (
    <div style={{ marginBottom: 14 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{ ...ui.buttonSmall, display: "inline-flex", alignItems: "center", gap: 6 }}
      >
        <span aria-hidden>{open ? "▼" : "▶"}</span>
        広告の一括登録(CSV)
      </button>
      <div style={{ display: open ? "block" : "none", marginTop: 12 }}>
    <div style={{ ...ui.section, marginBottom: 20 }}>
      <h2 style={ui.h2}>広告の一括登録</h2>
      <input
        type="file"
        accept={CSV_ACCEPT}
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleSelectFile(file);
          e.target.value = "";
        }}
      />
      {rows && summary && (
        <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.8 }}>
          <div>
            {fileName}：{summary.total.toLocaleString()}行 / 新規登録：<strong>{summary.create.toLocaleString()}件</strong>
            {` / 登録済み・重複でスキップ：${summary.duplicate}件`}
            {skipNote(summary)}
          </div>
          <button type="button" style={{ ...ui.buttonSmall, marginTop: 6 }} onClick={handleExecute} disabled={busy || summary.create === 0}>
            登録を実行
          </button>
        </div>
      )}
      {busy && <p style={{ fontSize: 12.5, marginTop: 8 }}>処理中…</p>}
      {message && <p style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.7 }}>{message}</p>}
      {error && <p style={{ fontSize: 12.5, marginTop: 8, color: "#c0392b" }}>{error}</p>}
    </div>
      </div>
    </div>
  );
}

function skipNote(s: { empty: number; invalidNumber: number; invalidUrl: number }): string {
  const parts: string[] = [];
  if (s.invalidNumber > 0) parts.push(`シナリオ・通数・成果単価が数値でない行：${s.invalidNumber}件`);
  if (s.invalidUrl > 0) parts.push(`遷移先URLがURLの形式でない、またはLIFF IDが空の行：${s.invalidUrl}件`);
  if (s.empty > 0) parts.push(`全項目が空の行：${s.empty}件`);
  return parts.length > 0 ? ` / ${parts.join(" / ")}(スキップ)` : "";
}
