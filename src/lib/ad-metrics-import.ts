// Flipdesk等からエクスポートしたCSV(シナリオ・日付ごとの行)から、
// 「日次レポート」用(日付だけで合算)・「ポップアップ別日次レポート」用(日付×ポップアップで合算)・
// 「シナリオ別日次レポート」用(日付×シナリオで合算)・「離脱地点別日次レポート」用(日付×離脱地点で合算)・
// 「訴求別日次レポート」用(日付×訴求で合算)・「設置先×訴求×…別月次レポート」用(日付×流入経路の名前で合算)のimp数・CL数を、1回のファイル読み込みでまとめて計算するための共通ロジック。
// 5つのレポート画面のどの取り込み口から使っても、同じ結果になるようにしている。
import { parseCsvNumber, parseJstDateKey } from "./csv-client";
import {
  extractAppealFromScenarioName,
  extractExitPointFromScenarioName,
  extractPopupFromScenarioName,
  extractPopupScenarioLabelFromScenarioName,
  extractScenarioFromScenarioName,
  extractSourceNameFromScenarioName,
} from "./scenario-popup";

export type AdMetricsByDate = { date: string; impCount: number; clCount: number };
export type AdMetricsByPopup = { date: string; popup: string; impCount: number; clCount: number };
export type AdMetricsByScenario = { date: string; scenario: string; impCount: number; clCount: number };
export type AdMetricsByExitPoint = { date: string; exitPoint: string; impCount: number; clCount: number };
export type AdMetricsByAppeal = { date: string; appeal: string; impCount: number; clCount: number };

export type AdMetricsBySource = { date: string; sourceName: string; impCount: number; clCount: number };

export type AdMetricsByPopupScenario = { date: string; label: string; impCount: number; clCount: number };

export type AdMetricsImportResult = {
  byDate: AdMetricsByDate[];
  byPopup: AdMetricsByPopup[];
  byScenario: AdMetricsByScenario[];
  byExitPoint: AdMetricsByExitPoint[];
  byAppeal: AdMetricsByAppeal[];
  bySource: AdMetricsBySource[];
  byPopupScenario: AdMetricsByPopupScenario[];
  // 「シナリオ」「グループ」列が両方見つかった場合のみポップアップ別・シナリオ別・離脱地点別・訴求別の内訳を計算する。
  // どちらか一方でも見出しが無いファイルの場合はfalseとなり、byPopup・byScenario・byExitPoint・byAppealは常に空になる
  // (日付単位の合算(byDate)は「日付」「自動ポップアップ表示回数」「ポップアップ内のクリック数」の3列だけで計算できるため)。
  hasBreakdownColumns: boolean;
  // hasBreakdownColumns===true のとき、それぞれの名前を判定できず内訳に含められなかった行数
  skippedForPopup: number;
  skippedForScenario: number;
  skippedForExitPoint: number;
  skippedForAppeal: number;
  skippedForSource: number;
  skippedForPopupScenario: number;
};

export function parseAdMetricsRows(csvRows: string[][]): AdMetricsImportResult | { error: string } {
  if (csvRows.length < 2) {
    return { error: "読み取れる行がありませんでした" };
  }

  const header = csvRows[0];
  const dateCol = header.indexOf("日付");
  const impCol = header.indexOf("自動ポップアップ表示回数");
  const clCol = header.indexOf("ポップアップ内のクリック数");
  if (dateCol === -1 || impCol === -1 || clCol === -1) {
    return {
      error: "見出し行に「日付」「自動ポップアップ表示回数」「ポップアップ内のクリック数」の列が見つかりませんでした",
    };
  }

  const scenarioCol = header.indexOf("シナリオ");
  const groupCol = header.indexOf("グループ");
  const hasBreakdownColumns = scenarioCol !== -1 && groupCol !== -1;

  const byDateMap = new Map<string, AdMetricsByDate>();
  const byPopupMap = new Map<string, AdMetricsByPopup>();
  const byScenarioMap = new Map<string, AdMetricsByScenario>();
  const byExitPointMap = new Map<string, AdMetricsByExitPoint>();
  const byAppealMap = new Map<string, AdMetricsByAppeal>();
  const bySourceMap = new Map<string, AdMetricsBySource>();
  const byPopupScenarioMap = new Map<string, AdMetricsByPopupScenario>();
  let skippedForPopup = 0;
  let skippedForScenario = 0;
  let skippedForExitPoint = 0;
  let skippedForAppeal = 0;
  let skippedForSource = 0;
  let skippedForPopupScenario = 0;

  csvRows.slice(1).forEach((r) => {
    const dateKey = parseJstDateKey(r[dateCol] ?? "");
    if (!dateKey) return; // 日付が読み取れない行はスキップ

    const imp = parseCsvNumber(r[impCol] ?? "") || 0;
    const cl = parseCsvNumber(r[clCol] ?? "") || 0;

    const currentDate = byDateMap.get(dateKey) ?? { date: dateKey, impCount: 0, clCount: 0 };
    byDateMap.set(dateKey, {
      date: dateKey,
      impCount: currentDate.impCount + imp,
      clCount: currentDate.clCount + cl,
    });

    if (hasBreakdownColumns) {
      const popup = extractPopupFromScenarioName(r[scenarioCol] ?? "", r[groupCol] ?? "");
      if (!popup) {
        skippedForPopup++;
      } else {
        const key = `${dateKey}__${popup}`;
        const current = byPopupMap.get(key) ?? { date: dateKey, popup, impCount: 0, clCount: 0 };
        byPopupMap.set(key, { ...current, impCount: current.impCount + imp, clCount: current.clCount + cl });
      }

      const scenario = extractScenarioFromScenarioName(r[scenarioCol] ?? "", r[groupCol] ?? "");
      if (!scenario) {
        skippedForScenario++;
      } else {
        const key = `${dateKey}__${scenario}`;
        const current = byScenarioMap.get(key) ?? { date: dateKey, scenario, impCount: 0, clCount: 0 };
        byScenarioMap.set(key, { ...current, impCount: current.impCount + imp, clCount: current.clCount + cl });
      }

      const exitPoint = extractExitPointFromScenarioName(r[scenarioCol] ?? "", r[groupCol] ?? "");
      if (!exitPoint) {
        skippedForExitPoint++;
      } else {
        const key = `${dateKey}__${exitPoint}`;
        const current = byExitPointMap.get(key) ?? { date: dateKey, exitPoint, impCount: 0, clCount: 0 };
        byExitPointMap.set(key, { ...current, impCount: current.impCount + imp, clCount: current.clCount + cl });
      }

      const appeal = extractAppealFromScenarioName(r[scenarioCol] ?? "", r[groupCol] ?? "");
      if (!appeal) {
        skippedForAppeal++;
      } else {
        const key = `${dateKey}__${appeal}`;
        const current = byAppealMap.get(key) ?? { date: dateKey, appeal, impCount: 0, clCount: 0 };
        byAppealMap.set(key, { ...current, impCount: current.impCount + imp, clCount: current.clCount + cl });
      }

      const sourceName = extractSourceNameFromScenarioName(r[scenarioCol] ?? "", r[groupCol] ?? "");
      if (!sourceName) {
        skippedForSource++;
      } else {
        const key = `${dateKey}__${sourceName}`;
        const current = bySourceMap.get(key) ?? { date: dateKey, sourceName, impCount: 0, clCount: 0 };
        bySourceMap.set(key, { ...current, impCount: current.impCount + imp, clCount: current.clCount + cl });
      }

      const popupScenarioLabel = extractPopupScenarioLabelFromScenarioName(r[scenarioCol] ?? "", r[groupCol] ?? "");
      if (!popupScenarioLabel) {
        skippedForPopupScenario++;
      } else {
        const key = `${dateKey}__${popupScenarioLabel}`;
        const current =
          byPopupScenarioMap.get(key) ?? { date: dateKey, label: popupScenarioLabel, impCount: 0, clCount: 0 };
        byPopupScenarioMap.set(key, { ...current, impCount: current.impCount + imp, clCount: current.clCount + cl });
      }
    }
  });

  return {
    byDate: Array.from(byDateMap.values()),
    byPopup: Array.from(byPopupMap.values()),
    byScenario: Array.from(byScenarioMap.values()),
    byExitPoint: Array.from(byExitPointMap.values()),
    byAppeal: Array.from(byAppealMap.values()),
    bySource: Array.from(bySourceMap.values()),
    byPopupScenario: Array.from(byPopupScenarioMap.values()),
    hasBreakdownColumns,
    skippedForPopup,
    skippedForScenario,
    skippedForExitPoint,
    skippedForAppeal,
    skippedForSource,
    skippedForPopupScenario,
  };
}
