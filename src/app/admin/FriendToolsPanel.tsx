"use client";

import { useState } from "react";
import * as ui from "./ui";
import { CSV_ACCEPT, parseCsvFile } from "@/lib/csv-client";
import { parseFriendImportRows, type FriendImportParsed } from "@/lib/lstep-import";

type Result = {
  matched: number;
  notFound: number;
  notFoundSample: number[];
  duplicateId: number;
  nameMismatch: number;
  nameMismatchSample: string[];
  addedAtSkippedNormal: number;
  addedAtSkippedFuture: number;
  sourceUnmatched: number;
  sourceUnmatchedSample: string[];
  addedAtUpdated: number;
  sourceUpdated: number;
  lstepUpdated: number;
  updatedFriends: number;
};

// 「友だち一覧」画面の上部に置く、CSVでの友だち情報の一括更新パネル。
// 見出し「ID」「表示名」「友だち追加日時」「流入経路名」「Lステップナンバー」のファイルを取り込み、
// IDが一致する友だちの、ファイルに値がある項目だけを更新する。
// 友だち一覧が見えにくくならないよう、普段は閉じておく(閉じている間も入力途中の状態は保持するため、非表示にするだけ)。
export default function FriendToolsPanel() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: 14 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{ ...ui.buttonSmall, display: "inline-flex", alignItems: "center", gap: 6 }}
      >
        <span aria-hidden>{open ? "▼" : "▶"}</span>
        友だち情報の一括更新(CSV)
      </button>
      <div style={{ display: open ? "block" : "none", marginTop: 12 }}>
        <BulkUpdatePanel />
      </div>
    </div>
  );
}

function BulkUpdatePanel() {
  const [busy, setBusy] = useState(false);
  const [parsed, setParsed] = useState<(FriendImportParsed & { fileName: string }) | null>(null);
  const [preview, setPreview] = useState<Result | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");

  async function post(rows: FriendImportParsed["rows"], check: boolean) {
    const res = await fetch("/api/admin/friends/bulk-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows, check }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "処理に失敗しました");
    return data as Result;
  }

  // 1. ファイルを読み込み、IDの突合結果を確認する(この時点では更新しない)
  async function handleSelectFile(file: File) {
    setBusy(true);
    setParsed(null);
    setPreview(null);
    setResult(null);
    setError("");
    try {
      const p = parseFriendImportRows(await parseCsvFile(file));
      if ("error" in p) {
        setError(p.error);
        return;
      }
      if (p.rows.length === 0) {
        setError("有効な行が見つかりませんでした");
        return;
      }
      setPreview(await post(p.rows, true));
      setParsed({ ...p, fileName: file.name });
    } catch (e) {
      setError(`読み込みに失敗しました: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  // 2. 更新を実行する
  async function handleExecute() {
    if (!parsed) return;
    setBusy(true);
    setError("");
    try {
      setResult(await post(parsed.rows, false));
      setParsed(null);
      setPreview(null);
      // 一覧(LogTable)に反映させるための再読み込みを知らせる
      window.dispatchEvent(new Event("lft:table-reload"));
    } catch (e) {
      setError(`更新に失敗しました: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  const notes = (r: Result) => {
    const list: string[] = [];
    if (r.notFound > 0) list.push(`IDが見つからない：${r.notFound}件(${r.notFoundSample.join("、")}${r.notFound > r.notFoundSample.length ? " ほか" : ""})`);
    if (r.duplicateId > 0) list.push(`同じIDの友だちが複数いて特定できない：${r.duplicateId}件`);
    if (r.addedAtSkippedNormal > 0) list.push(`導入前ではないため追加日時は変更なし：${r.addedAtSkippedNormal}件`);
    if (r.addedAtSkippedFuture > 0) list.push(`未来の日時のため追加日時は変更なし：${r.addedAtSkippedFuture}件`);
    if (r.sourceUnmatched > 0)
      list.push(`流入経路名が登録されておらず変更なし：${r.sourceUnmatched}件(${r.sourceUnmatchedSample.join("、")}${r.sourceUnmatched > r.sourceUnmatchedSample.length ? " ほか" : ""})`);
    if (r.nameMismatch > 0) list.push(`表示名がIDの友だちと異なる：${r.nameMismatch}件(${r.nameMismatchSample.join("、")}${r.nameMismatch > r.nameMismatchSample.length ? " ほか" : ""})`);
    return list;
  };

  return (
    <div style={{ ...ui.section, marginBottom: 20 }}>
      <h2 style={ui.h2}>友だち情報の一括更新</h2>
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
      {parsed && preview && (
        <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.8 }}>
          <div>
            {parsed.fileName}：{(parsed.rows.length + parsed.skipped).toLocaleString()}行 / IDが一致：<strong>{preview.matched.toLocaleString()}人</strong>
            (更新される友だち：{preview.updatedFriends.toLocaleString()}人)
          </div>
          <div style={ui.hint}>
            追加日時 {preview.addedAtUpdated.toLocaleString()}件 / 流入経路 {preview.sourceUpdated.toLocaleString()}件 / Lステップナンバー{" "}
            {preview.lstepUpdated.toLocaleString()}件
          </div>
          {parsed.skipped > 0 && (
            <div style={{ color: "#c0392b" }}>
              IDまたは日時を読み取れず対象外の行：{parsed.skipped}行({parsed.skippedSample.join("、")}
              {parsed.skipped > parsed.skippedSample.length ? " ほか" : ""})
            </div>
          )}
          {parsed.duplicated > 0 && <div style={ui.hint}>同じIDが複数行あるため、最後の行を使います：{parsed.duplicated}件</div>}
          {notes(preview).map((n) => (
            <div key={n} style={{ color: "#c0392b" }}>
              {n}
            </div>
          ))}
          <button type="button" style={{ ...ui.buttonSmall, marginTop: 6 }} onClick={handleExecute} disabled={busy || preview.updatedFriends === 0}>
            更新を実行
          </button>
        </div>
      )}
      {busy && <p style={{ fontSize: 12.5, marginTop: 8 }}>処理中…</p>}
      {result && (
        <div style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.7 }}>
          <div>
            更新した友だち：{result.updatedFriends}人(追加日時 {result.addedAtUpdated}件 / 流入経路 {result.sourceUpdated}件 / Lステップナンバー {result.lstepUpdated}件)
          </div>
          {notes(result).map((n) => (
            <div key={n}>{n}</div>
          ))}
        </div>
      )}
      {error && <p style={{ fontSize: 12.5, marginTop: 8, color: "#c0392b" }}>{error}</p>}
    </div>
  );
}
