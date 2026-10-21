"use client";

import { useState } from "react";
import * as ui from "./ui";
import { SPREADSHEET_ACCEPT, parseSpreadsheetFile } from "@/lib/csv-client";
import { parseLstepRows, type LstepImportRow } from "@/lib/lstep-import";
import { LSTEP_IMPORT_MAX_FRIENDS, formatLstepPeriod, lstepImportRange } from "@/lib/lstep-period";

// 「友だち一覧」画面の上部に置く、LステップのCSV/Excelを取り込んでのLステップナンバー付与パネル
// (表示名が完全一致、かつ友だち追加日時が一致・もしくは最も近い友だちに突合する)。
// なお「ID」(追加日時が古い順の連番)は新規の友だち追加時にWebhook側で自動採番されるのみで、
// 既存の友だちへの一括付与はテスト時に一度きり実行すれば良いものだったため、この画面には置いていない。
type Prepared = {
  fileName: string;
  rows: LstepImportRow[];
  period: string; // 「2026/09/01〜09/30」の形式
  friendCount: number | null; // 対象期間のこのツール側の友だち数(確認中はnull)
  tooMany: boolean;
};

// 友だち一覧が画面の上の方で見えにくくならないよう、取り込みの2つのパネルは普段は閉じておき、
// 見出しをクリックしたときだけ開く(閉じている間も入力途中の状態は保持するため、非表示にするだけで作り直さない)。
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
        データの取り込み(Lステップナンバー・導入前の友だち)
      </button>
      <div style={{ display: open ? "block" : "none", marginTop: 12 }}>
        <LstepNumberPanel />
        <EstimatedAddedAtPanel />
      </div>
    </div>
  );
}

function LstepNumberPanel() {
  const [busy, setBusy] = useState(false);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [lstepMessage, setLstepMessage] = useState("");
  const [lstepError, setLstepError] = useState("");

  // 1. ファイルを読み込み、CSVの追加日時の最小〜最大から対象期間を出す(この時点では取り込まない)
  async function handleSelectFile(file: File) {
    setBusy(true);
    setPrepared(null);
    setLstepMessage("");
    setLstepError("");
    try {
      const csvRows = await parseSpreadsheetFile(file);
      const parsed = parseLstepRows(csvRows);
      if ("error" in parsed) {
        setLstepError(parsed.error);
        return;
      }
      if (parsed.length === 0) {
        setLstepError("有効な行が見つかりませんでした");
        return;
      }
      const { minAt, maxAt } = lstepImportRange(parsed.map((r) => r.addedAt));
      const next: Prepared = {
        fileName: file.name,
        rows: parsed,
        period: formatLstepPeriod(minAt, maxAt),
        friendCount: null,
        tooMany: false,
      };
      setPrepared(next);

      // 対象期間の友だち数を確認する(読み込みはせず、件数だけを数える)
      const res = await fetch("/api/admin/friends/import-lstep-numbers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: parsed, check: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setPrepared({ ...next, friendCount: data.friendCount });
      } else if (data.code === "too_many_friends") {
        setPrepared({ ...next, friendCount: data.friendCount, tooMany: true });
      } else {
        setLstepError(data.error ?? "対象期間の確認に失敗しました");
        setPrepared(null);
      }
    } catch (e) {
      setLstepError(`読み込みに失敗しました: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  // 2. 取り込みを実行する(対象期間の友だちだけを読み込んで突合する)
  async function handleExecute() {
    if (!prepared || prepared.tooMany) return;
    setBusy(true);
    setLstepMessage("");
    setLstepError("");
    try {
      const res = await fetch("/api/admin/friends/import-lstep-numbers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: prepared.rows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "取り込みに失敗しました");

      const sample: { displayName: string }[] = data.unmatchedSample ?? [];
      const sampleNote =
        data.unmatched > 0 && sample.length > 0
          ? `(未突合の例: ${sample.map((s) => s.displayName).join("、")}${data.unmatched > sample.length ? " ほか" : ""})`
          : "";
      setLstepMessage(
        `対象期間：${prepared.period} / 付与できた件数：${data.matched}件 / 未突合：${data.unmatched}件${sampleNote}`
      );
      setPrepared(null);
      // 一覧(LogTable)に、取り込み結果を反映させるための再読み込みを知らせる
      window.dispatchEvent(new Event("lft:table-reload"));
    } catch (e) {
      setLstepError(`取り込みに失敗しました: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ ...ui.section, marginBottom: 20 }}>
      <h2 style={ui.h2}>Lステップナンバーの取り込み</h2>

      <div>
        <input
          type="file"
          accept={SPREADSHEET_ACCEPT}
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleSelectFile(file);
            e.target.value = "";
          }}
        />
        {prepared && (
          <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.8 }}>
            <div>
              対象期間：<strong>{prepared.period}</strong>({prepared.rows.length}行)
            </div>
            {prepared.friendCount !== null && !prepared.tooMany && (
              <div style={ui.hint}>期間内の友だち：{prepared.friendCount.toLocaleString()}人</div>
            )}
            {prepared.tooMany && (
              <div style={{ color: "#c0392b" }}>
                対象期間の友だちが{prepared.friendCount?.toLocaleString()}人います(上限{LSTEP_IMPORT_MAX_FRIENDS.toLocaleString()}人)。期間を分けて取り込んでください。
              </div>
            )}
            <button
              type="button"
              style={{ ...ui.buttonSmall, marginTop: 6 }}
              onClick={handleExecute}
              disabled={busy || prepared.friendCount === null || prepared.tooMany}
            >
              取り込みを実行
            </button>
          </div>
        )}
        {busy && <p style={{ fontSize: 12.5, marginTop: 8 }}>処理中…</p>}
        {lstepMessage && <p style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.7 }}>{lstepMessage}</p>}
        {lstepError && <p style={{ fontSize: 12.5, marginTop: 8, color: "#c0392b" }}>{lstepError}</p>}
      </div>
    </div>
  );
}

// 導入前から友だちだった人(流入経路リンクを初めて踏んだときに自動登録された人)は、友だち一覧の「導入前」列に印が付く。
// 追加日時は最初「リンクを踏んだ日時」の仮の値。LステップのCSVで、追加日時・流入経路を何度でも修正できる。
function EstimatedAddedAtPanel() {
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<LstepImportRow[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [estimatedCount, setEstimatedCount] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function handleSelectFile(file: File) {
    setBusy(true);
    setRows(null);
    setEstimatedCount(null);
    setMessage("");
    setError("");
    try {
      const parsed = parseLstepRows(await parseSpreadsheetFile(file));
      if ("error" in parsed) {
        setError(parsed.error);
        return;
      }
      if (parsed.length === 0) {
        setError("有効な行が見つかりませんでした");
        return;
      }
      const res = await fetch("/api/admin/friends/update-added-at", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: parsed, check: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "確認に失敗しました");
      setRows(parsed);
      setFileName(file.name);
      setEstimatedCount(data.preExistingCount);
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
      const res = await fetch("/api/admin/friends/update-added-at", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "更新に失敗しました");
      const sample: string[] = data.ambiguousSample ?? [];
      const ambiguousNote =
        data.ambiguous > 0
          ? ` / 同名のため未更新：${data.ambiguous}人(${sample.join("、")}${data.ambiguous > sample.length ? " ほか" : ""})`
          : "";
      const sourceNote =
        data.sourceUpdated > 0 || data.sourceUnmatched > 0
          ? ` / 流入経路の更新：${data.sourceUpdated}件(名前が一致せず変更なし：${data.sourceUnmatched}件)`
          : "";
      setMessage(`更新できた件数：${data.updated}件${sourceNote}${ambiguousNote} / 日時が未確定の友だち：${data.remaining}人`);
      setRows(null);
      setEstimatedCount(null);
      window.dispatchEvent(new Event("lft:table-reload"));
    } catch (e) {
      setError(`更新に失敗しました: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ ...ui.section, marginBottom: 20 }}>
      <h2 style={ui.h2}>導入前の友だちの追加日時・流入経路の更新</h2>
      <input
        type="file"
        accept={SPREADSHEET_ACCEPT}
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleSelectFile(file);
          e.target.value = "";
        }}
      />
      {rows && estimatedCount !== null && (
        <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.8 }}>
          <div>
            {fileName}：{rows.length.toLocaleString()}行 / 導入前の友だち：<strong>{estimatedCount.toLocaleString()}人</strong>
          </div>
          <button type="button" style={{ ...ui.buttonSmall, marginTop: 6 }} onClick={handleExecute} disabled={busy || estimatedCount === 0}>
            更新を実行
          </button>
        </div>
      )}
      {busy && <p style={{ fontSize: 12.5, marginTop: 8 }}>処理中…</p>}
      {message && <p style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.7 }}>{message}</p>}
      {error && <p style={{ fontSize: 12.5, marginTop: 8, color: "#c0392b" }}>{error}</p>}
    </div>
  );
}
