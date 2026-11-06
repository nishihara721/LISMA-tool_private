"use client";

import { useEffect, useState } from "react";
import * as ui from "../../ui";
import { daysAgoJST, todayJST } from "@/lib/csv-client";

type ResultItem = { sheetName: string; ok: boolean; error?: string };

// 「データ」メニューの新しいページ。日次・ポップアップ別・シナリオ別・訴求別・離脱地点別の
// 5つのレポートを、指定した期間についてまとめて計算し、ボタン1つでスプレッドシートの5つのシートへ送信する。
//
// 送信先は既存のログ送信(各ログ画面の「スプレッドシートに送信」)と同じGoogle Apps Script Webアプリ
// (SHEETS_EXPORT_WEBHOOK_URL)。書き込み方法は「蓄積モード」固定で、送信するたびに
// 日付をキーに既存の行を更新・新しい日付の行を追加していく(過去のデータは消えない)。
// 新しいポップアップ・シナリオ・訴求・離脱地点が登場した場合は、該当シートの右側に列が追加され、
// それより前の日付のその列は空欄のままになる。
//
// スプレッドシート(URLまたはID)は、既存のログ画面の「スプレッドシートに送信」と同様、
// 直前に使った内容をブラウザに保存しておき、次回開いた際に初期値として復元する(入力の手間を省くための
// 補助であり、空欄で送信した場合の動作(GAS側のバインド先スプレッドシートを使う)自体は変わらない)。
const SPREADSHEET_STORAGE_KEY = "lft_reportSheetExport_spreadsheet";

function loadSavedSpreadsheet(): string {
  try {
    return localStorage.getItem(SPREADSHEET_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveSpreadsheet(value: string) {
  try {
    if (value) localStorage.setItem(SPREADSHEET_STORAGE_KEY, value);
    else localStorage.removeItem(SPREADSHEET_STORAGE_KEY);
  } catch {
    // 保存できなくても送信自体には影響させない
  }
}

export default function SheetExportPage() {
  const [from, setFrom] = useState(daysAgoJST(6));
  const [to, setTo] = useState(todayJST());
  const [spreadsheet, setSpreadsheet] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<ResultItem[] | null>(null);

  useEffect(() => {
    setSpreadsheet(loadSavedSpreadsheet());
  }, []);

  async function handleSend() {
    if (!from || !to || from > to) {
      setError("期間の指定が不正です");
      return;
    }
    setSending(true);
    setError("");
    setResults(null);
    const trimmedSpreadsheet = spreadsheet.trim();
    saveSpreadsheet(trimmedSpreadsheet);
    try {
      const res = await fetch("/api/report/sheet-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, spreadsheet: trimmedSpreadsheet || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "送信に失敗しました");
      setResults(data.results ?? []);
      if (!data.ok) setError("一部のシートへの送信に失敗しました(詳細は下の一覧を確認してください)");
    } catch (e) {
      setError(String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <main style={ui.page}>
      <h1 style={ui.h1}>レポートのスプレッドシート送信</h1>
      <p style={{ fontSize: 13.5, color: "#5b6b72", margin: "0 0 18px", lineHeight: 1.7 }}>
        指定した期間の「日次」「ポップアップ別」「シナリオ別」「訴求別」「離脱地点別」の5つのレポートをまとめて計算し、
        同じスプレッドシートの5つのシート(デイリー / デイリー(p別) / デイリー(s別) / デイリー(訴求別) / デイリー(離脱地点別))へ
        1回の操作で送信します。日付をキーに既存の行を更新・新しい日付を追加していくので、何度送信しても過去のデータは消えません。
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end", marginBottom: 16 }}>
        <div style={ui.filterField}>
          <label style={ui.filterLabel}>期間(開始)</label>
          <input type="date" style={ui.filterInput} value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div style={ui.filterField}>
          <label style={ui.filterLabel}>期間(終了)</label>
          <input type="date" style={ui.filterInput} value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div style={{ ...ui.filterField, minWidth: 320 }}>
          <label style={ui.filterLabel}>スプレッドシート(URLまたはID・空欄でGAS側の既定を使用・直前の入力を保存)</label>
          <input
            type="text"
            placeholder="https://docs.google.com/spreadsheets/d/xxxxx/edit または xxxxx"
            style={ui.filterInput}
            value={spreadsheet}
            onChange={(e) => setSpreadsheet(e.target.value)}
          />
        </div>
        <button type="button" style={ui.buttonPrimary} onClick={handleSend} disabled={sending}>
          {sending ? "送信中…" : "5レポートを一括送信"}
        </button>
      </div>

      {error && <p style={{ color: "#c0392b", fontSize: 13.5, marginBottom: 12 }}>{error}</p>}

      {results && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, fontSize: 13.5 }}>
          {results.map((r) => (
            <li
              key={r.sheetName}
              style={{
                padding: "8px 12px",
                marginBottom: 6,
                borderRadius: 6,
                background: r.ok ? "#eef7ee" : "#fbeaea",
                color: r.ok ? "#2d6a2d" : "#a33",
              }}
            >
              {r.ok ? "✓" : "✗"} {r.sheetName}
              {!r.ok && r.error ? `: ${r.error}` : ""}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
