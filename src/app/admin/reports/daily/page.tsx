"use client";

import { useState } from "react";
import DailyReportView from "./DailyReportView";
import MonthlyReportView from "./MonthlyReportView";

// 日次レポート(合算)と月次レポート(合算)を、同じページ内のラジオボタンで切り替える。
// 日次と月次はそれぞれ別のコンポーネント(DailyReportView / MonthlyReportView)で、
// 一度開いた画面は表示を隠すだけで残すため、日次⇔月次を切り替えても取得済みのデータを再取得せず、
// 指定した期間や表示結果もそのまま保たれる(初めて開くときだけ読み込む)。
type Mode = "daily" | "monthly";

export default function DailyAndMonthlyReportPage() {
  const [mode, setMode] = useState<Mode>("daily");
  const [visited, setVisited] = useState<Record<Mode, boolean>>({ daily: true, monthly: false });

  const modeSwitch = (
    <div role="radiogroup" aria-label="集計単位" style={{ display: "flex", gap: 18, margin: "0 0 14px", fontSize: 14 }}>
      {(
        [
          ["daily", "日次"],
          ["monthly", "月次"],
        ] as const
      ).map(([value, label]) => (
        <label key={value} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input
            type="radio"
            name="report-mode"
            value={value}
            checked={mode === value}
            onChange={() => {
              setMode(value);
              setVisited((v) => ({ ...v, [value]: true }));
            }}
          />
          {label}
        </label>
      ))}
    </div>
  );

  return (
    <>
      <div hidden={mode !== "daily"}>{visited.daily && <DailyReportView modeSwitch={modeSwitch} />}</div>
      <div hidden={mode !== "monthly"}>{visited.monthly && <MonthlyReportView modeSwitch={modeSwitch} />}</div>
    </>
  );
}
