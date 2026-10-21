"use client";

import { useState } from "react";
import * as ui from "../../ui";
import { SPREADSHEET_ACCEPT, parseSpreadsheetFile } from "@/lib/csv-client";
import { parseAdMetricsRows } from "@/lib/ad-metrics-import";
import { parseAppealPvRows, parsePvRows } from "@/lib/pv-import";

// imp数・CL数のCSV/Excel取り込み専用ページ。
// 「日次レポート」「ポップアップ別日次レポート」「シナリオ別日次レポート」「離脱地点別日次レポート」
// 「訴求別日次レポート」それぞれに取り込み口があると分かりにくいため、取り込みはこのページに一本化し、
// 1回の取り込みで5つのレポート(および月次のポップアップ×シナリオ別・設置先×訴求×…別レポート)すべてに反映する。
// 集計結果を見るには、取り込み後にそれぞれのレポート画面を開く。
export default function AdMetricsImportPage() {
  const [busy, setBusy] = useState(false);
  const [resultMessage, setResultMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const [pvBusy, setPvBusy] = useState(false);
  const [pvResultMessage, setPvResultMessage] = useState("");
  const [pvErrorMessage, setPvErrorMessage] = useState("");

  const [appealPvBusy, setAppealPvBusy] = useState(false);
  const [appealPvResultMessage, setAppealPvResultMessage] = useState("");
  const [appealPvErrorMessage, setAppealPvErrorMessage] = useState("");

  async function handleImportAdMetricsFile(file: File) {
    setBusy(true);
    setResultMessage("");
    setErrorMessage("");
    try {
      const csvRows = await parseSpreadsheetFile(file);
      const parsed = parseAdMetricsRows(csvRows);
      if ("error" in parsed) {
        setErrorMessage(parsed.error);
        return;
      }
      if (parsed.byDate.length === 0) {
        setErrorMessage("有効な日付の行が見つかりませんでした");
        return;
      }

      const dailyRes = await fetch("/api/report/ad-metrics/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: parsed.byDate }),
      });
      const dailyData = await dailyRes.json();
      if (!dailyRes.ok) throw new Error(dailyData.error ?? "日次レポートへの取り込みに失敗しました");

      let breakdownNote =
        "「シナリオ」「グループ」列が見つからなかったため、ポップアップ別・シナリオ別・離脱地点別・訴求別レポートへの取り込みはスキップしました。";
      if (parsed.hasBreakdownColumns) {
        const notes: string[] = [];

        if (parsed.byPopup.length > 0) {
          const popupRes = await fetch("/api/report/ad-metrics-by-popup/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rows: parsed.byPopup }),
          });
          const popupData = await popupRes.json();
          if (!popupRes.ok) throw new Error(popupData.error ?? "ポップアップ別レポートへの取り込みに失敗しました");
          const skippedNote =
            parsed.skippedForPopup > 0 ? `(${parsed.skippedForPopup}行はポップアップ名を判定できずスキップ)` : "";
          notes.push(`ポップアップ別レポートに${parsed.byPopup.length}件(日付×ポップアップ)分${skippedNote}`);
        }

        if (parsed.byScenario.length > 0) {
          const scenarioRes = await fetch("/api/report/ad-metrics-by-scenario/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rows: parsed.byScenario }),
          });
          const scenarioData = await scenarioRes.json();
          if (!scenarioRes.ok) throw new Error(scenarioData.error ?? "シナリオ別レポートへの取り込みに失敗しました");
          const skippedNote =
            parsed.skippedForScenario > 0
              ? `(${parsed.skippedForScenario}行はシナリオ名を判定できずスキップ)`
              : "";
          notes.push(`シナリオ別レポートに${parsed.byScenario.length}件(日付×シナリオ)分${skippedNote}`);
        }

        if (parsed.byExitPoint.length > 0) {
          const exitPointRes = await fetch("/api/report/ad-metrics-by-exit-point/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rows: parsed.byExitPoint }),
          });
          const exitPointData = await exitPointRes.json();
          if (!exitPointRes.ok) throw new Error(exitPointData.error ?? "離脱地点別レポートへの取り込みに失敗しました");
          const skippedNote =
            parsed.skippedForExitPoint > 0
              ? `(${parsed.skippedForExitPoint}行は離脱地点名を判定できずスキップ)`
              : "";
          notes.push(`離脱地点別レポートに${parsed.byExitPoint.length}件(日付×離脱地点)分${skippedNote}`);
        }

        if (parsed.byAppeal.length > 0) {
          const appealRes = await fetch("/api/report/ad-metrics-by-appeal/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rows: parsed.byAppeal }),
          });
          const appealData = await appealRes.json();
          if (!appealRes.ok) throw new Error(appealData.error ?? "訴求別レポートへの取り込みに失敗しました");
          const skippedNote =
            parsed.skippedForAppeal > 0 ? `(${parsed.skippedForAppeal}行は訴求名を判定できずスキップ)` : "";
          notes.push(`訴求別レポートに${parsed.byAppeal.length}件(日付×訴求)分${skippedNote}`);
        }

        if (parsed.bySource.length > 0) {
          const sourceRes = await fetch("/api/report/ad-metrics-by-source/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rows: parsed.bySource }),
          });
          const sourceData = await sourceRes.json();
          if (!sourceRes.ok) throw new Error(sourceData.error ?? "月次レポート(流入経路単位)への取り込みに失敗しました");
          const skippedNote =
            parsed.skippedForSource > 0 ? `(${parsed.skippedForSource}行は流入経路の名前を判定できずスキップ)` : "";
          notes.push(
            `設置先×訴求×離脱地点×ポップアップ×シナリオ×中間別月次レポートに${parsed.bySource.length}件(日付×流入経路の名前)分${skippedNote}`
          );
        }

        if (parsed.byPopupScenario.length > 0) {
          const psRes = await fetch("/api/report/ad-metrics-by-popup-scenario/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rows: parsed.byPopupScenario }),
          });
          const psData = await psRes.json();
          if (!psRes.ok) throw new Error(psData.error ?? "ポップアップ×シナリオ別月次レポートへの取り込みに失敗しました");
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

      setResultMessage(`日次レポートに${parsed.byDate.length}日分のimp数・CL数を取り込みました。${breakdownNote}`);
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
      const csvRows = await parseSpreadsheetFile(file);
      const parsed = parsePvRows(csvRows);
      if ("error" in parsed) {
        setPvErrorMessage(parsed.error);
        return;
      }
      if (parsed.length === 0) {
        setPvErrorMessage("有効な日付の行が見つかりませんでした");
        return;
      }

      const res = await fetch("/api/report/ad-metrics/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: parsed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "取り込みに失敗しました");
      setPvResultMessage(`日次レポートに${parsed.length}日分のPV数を取り込みました。`);
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
      const csvRows = await parseSpreadsheetFile(file);
      const parsed = parseAppealPvRows(csvRows);
      if ("error" in parsed) {
        setAppealPvErrorMessage(parsed.error);
        return;
      }
      if (parsed.length === 0) {
        setAppealPvErrorMessage("有効な(日付, 訴求)の行が見つかりませんでした");
        return;
      }

      const res = await fetch("/api/report/ad-metrics-by-appeal/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: parsed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "取り込みに失敗しました");
      setAppealPvResultMessage(`訴求別日次レポートに${parsed.length}件(日付×訴求)分のPV数を取り込みました。`);
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
          accept={SPREADSHEET_ACCEPT}
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
      </div>

      <div style={ui.section}>
        <h2 style={ui.h2}>PV数</h2>
        <input
          type="file"
          accept={SPREADSHEET_ACCEPT}
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
          accept={SPREADSHEET_ACCEPT}
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
      </div>
    </main>
  );
}
