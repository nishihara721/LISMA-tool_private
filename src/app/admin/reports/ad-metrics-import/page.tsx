"use client";

import { useCallback, useEffect, useState } from "react";
import * as ui from "../../ui";
import { CSV_ACCEPT, parseCsvFile } from "@/lib/csv-client";
import { parseAdMetricsRows } from "@/lib/ad-metrics-import";
import { countUnreadableSlashDates } from "@/lib/csv-client";
import { parseAppealPvRows, parsePvRows } from "@/lib/pv-import";

// imp数・CL数のCSV取り込み専用ページ。
// 「日次レポート」「ポップアップ別日次レポート」「シナリオ別日次レポート」「離脱地点別日次レポート」
// 「訴求別日次レポート」それぞれに取り込み口があると分かりにくいため、取り込みはこのページに一本化し、
// 1回の取り込みで5つのレポート(および月次のポップアップ×シナリオ別・設置先×訴求×…別レポート)すべてに反映する。
// 集計結果を見るには、取り込み後にそれぞれのレポート画面を開く。
type ImportRecord = {
  importId: string;
  createdAt: number;
  createdBy: string;
  fileName: string;
  dateFrom: string;
  dateTo: string;
  counts: Record<string, number>;
  status: "applying" | "applied" | "undone";
};

// 取り込み履歴と、取り消しの操作。imp数・CL数の取り込みと、訴求別PV数の取り込みで共通に使う。
// 取り消せるのは、取り消していない取り込みのうち一番新しい1件だけ(新しい順に取り消す)。
function ImportHistory({ endpoint, reloadKey }: { endpoint: string; reloadKey: number }) {
  const [history, setHistory] = useState<ImportRecord[]>([]);
  const [latestActiveId, setLatestActiveId] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [confirmUndoId, setConfirmUndoId] = useState<string | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const [undoMessage, setUndoMessage] = useState("");

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(endpoint, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "取り込み履歴の取得に失敗しました");
      setHistory(data.records ?? []);
      setLatestActiveId(data.latestActiveId ?? null);
      setHistoryError("");
    } catch (e) {
      setHistoryError(String(e));
    }
  }, [endpoint]);
  useEffect(() => {
    loadHistory();
  }, [loadHistory, reloadKey]);

  async function undoImport(importId: string) {
    setUndoBusy(true);
    setUndoMessage("");
    try {
      const res = await fetch(`/api/admin/ad-metrics-import/${importId}/undo`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "取り消しに失敗しました");
      setUndoMessage(`取り込みを取り消しました(${data.restored}件を取り込み前の値に戻しました)。`);
      setConfirmUndoId(null);
      await loadHistory();
    } catch (e) {
      setUndoMessage(`取り消しに失敗しました: ${e}`);
    } finally {
      setUndoBusy(false);
    }
  }

  return (
    <>
        <h3 style={{ fontSize: 13.5, margin: "18px 0 6px" }}>取り込み履歴</h3>
        {historyError && <p style={{ fontSize: 12.5, color: "#c0392b" }}>{historyError}</p>}
        {undoMessage && <p style={{ fontSize: 12.5, margin: "0 0 8px", lineHeight: 1.7 }}>{undoMessage}</p>}
        {history.length === 0 && !historyError ? (
          <p style={{ fontSize: 12.5, color: "#6b7280" }}>取り込み履歴はまだありません。</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 12.5, width: "100%" }}>
              <thead>
                <tr>
                  {["取り込み日時", "ファイル名", "対象の日付", "日付の件数", "状態", ""].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #d1d5db", whiteSpace: "nowrap" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((r) => {
                  const undone = r.status === "undone";
                  const canUndo = r.importId === latestActiveId;
                  return (
                    <tr key={r.importId} style={{ opacity: undone ? 0.55 : 1 }}>
                      <td style={{ padding: "6px 8px", borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap" }}>
                        {new Date(r.createdAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
                      </td>
                      <td style={{ padding: "6px 8px", borderBottom: "1px solid #e5e7eb", wordBreak: "break-all" }}>{r.fileName || "-"}</td>
                      <td style={{ padding: "6px 8px", borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap" }}>
                        {r.dateFrom === r.dateTo ? r.dateFrom : `${r.dateFrom}〜${r.dateTo}`}
                      </td>
                      <td style={{ padding: "6px 8px", borderBottom: "1px solid #e5e7eb" }}>{r.counts?.byDate ?? "-"}</td>
                      <td style={{ padding: "6px 8px", borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap" }}>
                        {undone ? "取り消し済み" : r.status === "applying" ? "途中で中断(取り消しで元に戻せます)" : "取り込み済み"}
                      </td>
                      <td style={{ padding: "6px 8px", borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap" }}>
                        {!undone &&
                          canUndo &&
                          (confirmUndoId === r.importId ? (
                            <>
                              <button type="button" style={ui.buttonPrimary} disabled={undoBusy} onClick={() => undoImport(r.importId)}>
                                {undoBusy ? "取り消し中…" : "取り消しを実行"}
                              </button>{" "}
                              <button type="button" style={ui.button} disabled={undoBusy} onClick={() => setConfirmUndoId(null)}>
                                やめる
                              </button>
                            </>
                          ) : (
                            <button type="button" style={ui.button} onClick={() => setConfirmUndoId(r.importId)}>
                              この取り込みを取り消す
                            </button>
                          ))}
                        {!undone && !canUndo && <span style={{ color: "#6b7280" }}>新しい取り込みを先に取り消す</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
    </>
  );
}

export default function AdMetricsImportPage() {
  const [busy, setBusy] = useState(false);
  const [resultMessage, setResultMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const [historyReload, setHistoryReload] = useState(0);
  const [appealHistoryReload, setAppealHistoryReload] = useState(0);

  const [pvBusy, setPvBusy] = useState(false);
  const [pvResultMessage, setPvResultMessage] = useState("");
  const [pvErrorMessage, setPvErrorMessage] = useState("");

  const [appealPvBusy, setAppealPvBusy] = useState(false);
  const [appealPvResultMessage, setAppealPvResultMessage] = useState("");
  const [appealPvErrorMessage, setAppealPvErrorMessage] = useState("");

const dateSkipNote = (rows: string[][]) => { const n = countUnreadableSlashDates(rows); return n > 0 ? `(日付がYYYY/MM/DD形式でない${n}行は読み込んでいません)` : ""; };

  async function handleImportAdMetricsFile(file: File) {
    setBusy(true);
    setResultMessage("");
    setErrorMessage("");
    try {
      const csvRows = await parseCsvFile(file);
      const parsed = parseAdMetricsRows(csvRows);
      if ("error" in parsed) {
        setErrorMessage(parsed.error);
        return;
      }
      if (parsed.byDate.length === 0) {
        setErrorMessage("YYYY/MM/DD形式(例: 2026/10/19)の日付の行が見つかりませんでした");
        return;
      }

      // 取り込み前の値を控えたうえで、日次・各内訳をまとめて1回で取り込む(あとから取り消せる)
      const importRes = await fetch("/api/admin/ad-metrics-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          byDate: parsed.byDate,
          byPopup: parsed.byPopup,
          byScenario: parsed.byScenario,
          byExitPoint: parsed.byExitPoint,
          byAppeal: parsed.byAppeal,
          bySource: parsed.bySource,
          byPopupScenario: parsed.byPopupScenario,
        }),
      });
      const importData = await importRes.json();
      if (!importRes.ok) throw new Error(importData.error ?? "取り込みに失敗しました");

      let breakdownNote =
        "「シナリオ」「グループ」列が見つからなかったため、ポップアップ別・シナリオ別・離脱地点別・訴求別レポートへの取り込みはスキップしました。";
      if (parsed.hasBreakdownColumns) {
        const notes: string[] = [];

        if (parsed.byPopup.length > 0) {
          const skippedNote =
            parsed.skippedForPopup > 0 ? `(${parsed.skippedForPopup}行はポップアップ名を判定できずスキップ)` : "";
          notes.push(`ポップアップ別レポートに${parsed.byPopup.length}件(日付×ポップアップ)分${skippedNote}`);
        }

        if (parsed.byScenario.length > 0) {
          const skippedNote =
            parsed.skippedForScenario > 0
              ? `(${parsed.skippedForScenario}行はシナリオ名を判定できずスキップ)`
              : "";
          notes.push(`シナリオ別レポートに${parsed.byScenario.length}件(日付×シナリオ)分${skippedNote}`);
        }

        if (parsed.byExitPoint.length > 0) {
          const skippedNote =
            parsed.skippedForExitPoint > 0
              ? `(${parsed.skippedForExitPoint}行は離脱地点名を判定できずスキップ)`
              : "";
          notes.push(`離脱地点別レポートに${parsed.byExitPoint.length}件(日付×離脱地点)分${skippedNote}`);
        }

        if (parsed.byAppeal.length > 0) {
          const skippedNote =
            parsed.skippedForAppeal > 0 ? `(${parsed.skippedForAppeal}行は訴求名を判定できずスキップ)` : "";
          notes.push(`訴求別レポートに${parsed.byAppeal.length}件(日付×訴求)分${skippedNote}`);
        }

        if (parsed.bySource.length > 0) {
          const skippedNote =
            parsed.skippedForSource > 0 ? `(${parsed.skippedForSource}行は流入経路の名前を判定できずスキップ)` : "";
          notes.push(
            `設置先×訴求×離脱地点×ポップアップ×シナリオ×中間別月次レポートに${parsed.bySource.length}件(日付×流入経路の名前)分${skippedNote}`
          );
        }

        if (parsed.byPopupScenario.length > 0) {
          const skippedNote =
            parsed.skippedForPopupScenario > 0
              ? `(${parsed.skippedForPopupScenario}行はポップアップ・シナリオを判定できずスキップ)`
              : "";
          notes.push(`ポップアップ×シナリオ別月次レポートに${parsed.byPopupScenario.length}件(日付×ポップアップ×シナリオ)分${skippedNote}`);
        }

        breakdownNote =
          notes.length > 0
            ? `${notes.join("。")}を取り込みました。`
            : "ポップアップ別・シナリオ別・離脱地点別・訴求別レポートに取り込める行はありませんでした。";
      }

      setResultMessage(`日次レポートに${parsed.byDate.length}日分のimp数・CL数を取り込みました。${breakdownNote}${dateSkipNote(csvRows)}`);
      setHistoryReload((n) => n + 1);
    } catch (e) {
      setErrorMessage(`取り込みに失敗しました: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleImportPvFile(file: File) {
    setPvBusy(true);
    setPvResultMessage("");
    setPvErrorMessage("");
    try {
      const csvRows = await parseCsvFile(file);
      const parsed = parsePvRows(csvRows);
      if ("error" in parsed) {
        setPvErrorMessage(parsed.error);
        return;
      }
      if (parsed.length === 0) {
        setPvErrorMessage("YYYY/MM/DD形式(例: 2026/10/19)の日付の行が見つかりませんでした");
        return;
      }

      const res = await fetch("/api/report/ad-metrics/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: parsed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "取り込みに失敗しました");
      const dates = parsed.map((r) => r.date).sort();
      const total = parsed.reduce((sum, r) => sum + r.pvCount, 0);
      setPvResultMessage(
        `日次レポートに${parsed.length}日分のPV数を取り込みました(${dates[0]}〜${dates[dates.length - 1]}、PV数の合計 ${total.toLocaleString("ja-JP")})。${dateSkipNote(csvRows)}`
      );
    } catch (e) {
      setPvErrorMessage(`取り込みに失敗しました: ${e}`);
    } finally {
      setPvBusy(false);
    }
  }

  async function handleImportAppealPvFile(file: File) {
    setAppealPvBusy(true);
    setAppealPvResultMessage("");
    setAppealPvErrorMessage("");
    try {
      const csvRows = await parseCsvFile(file);
      const parsed = parseAppealPvRows(csvRows);
      if ("error" in parsed) {
        setAppealPvErrorMessage(parsed.error);
        return;
      }
      if (parsed.length === 0) {
        setAppealPvErrorMessage("YYYY/MM/DD形式(例: 2026/10/19)の日付と、数値の入った訴求の行が見つかりませんでした");
        return;
      }

      const res = await fetch("/api/admin/appeal-pv-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, rows: parsed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "取り込みに失敗しました");
      setAppealPvResultMessage(`訴求別日次レポートに${parsed.length}件(日付×訴求)分のPV数を取り込みました。${dateSkipNote(csvRows)}`);
      setAppealHistoryReload((n) => n + 1);
    } catch (e) {
      setAppealPvErrorMessage(`取り込みに失敗しました: ${e}`);
    } finally {
      setAppealPvBusy(false);
    }
  }

  return (
    <main style={ui.page}>
      <h1 style={ui.h1}>データ取り込み</h1>

      <div style={ui.section}>
        <h2 style={ui.h2}>フリップデスクデータ</h2>
        <input
          type="file"
          accept={CSV_ACCEPT}
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImportAdMetricsFile(file);
            e.target.value = "";
          }}
        />
        {busy && <p style={{ fontSize: 12.5, marginTop: 8 }}>取り込み中…</p>}
        {resultMessage && <p style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.7 }}>{resultMessage}</p>}
        {errorMessage && <p style={{ fontSize: 12.5, marginTop: 8, color: "#c0392b" }}>{errorMessage}</p>}

        <ImportHistory endpoint="/api/admin/ad-metrics-import" reloadKey={historyReload} />
      </div>

      <div style={ui.section}>
        <h2 style={ui.h2}>PV数</h2>
        <input
          type="file"
          accept={CSV_ACCEPT}
          disabled={pvBusy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImportPvFile(file);
            e.target.value = "";
          }}
        />
        {pvBusy && <p style={{ fontSize: 12.5, marginTop: 8 }}>取り込み中…</p>}
        {pvResultMessage && <p style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.7 }}>{pvResultMessage}</p>}
        {pvErrorMessage && <p style={{ fontSize: 12.5, marginTop: 8, color: "#c0392b" }}>{pvErrorMessage}</p>}
      </div>

      <div style={ui.section}>
        <h2 style={ui.h2}>訴求別PV数</h2>
        <input
          type="file"
          accept={CSV_ACCEPT}
          disabled={appealPvBusy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImportAppealPvFile(file);
            e.target.value = "";
          }}
        />
        {appealPvBusy && <p style={{ fontSize: 12.5, marginTop: 8 }}>取り込み中…</p>}
        {appealPvResultMessage && (
          <p style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.7 }}>{appealPvResultMessage}</p>
        )}
        {appealPvErrorMessage && (
          <p style={{ fontSize: 12.5, marginTop: 8, color: "#c0392b" }}>{appealPvErrorMessage}</p>
        )}

        <ImportHistory endpoint="/api/admin/appeal-pv-import" reloadKey={appealHistoryReload} />
      </div>
    </main>
  );
}
