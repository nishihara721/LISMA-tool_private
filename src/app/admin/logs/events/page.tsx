import * as ui from "../../ui";
import LogTable, { type Column, type FilterDef } from "../LogTable";

export const dynamic = "force-dynamic";

const COLUMNS: Column[] = [
  { key: "createdAt", label: "発生日時" },
  { key: "level", label: "レベル", render: "level" },
  { key: "stage", label: "ステージ", render: "code" },
  { key: "message", label: "内容" },
  { key: "context", label: "詳細", render: "codeSmall" },
];

const filters: FilterDef[] = [
  { key: "createdAt", label: "発生日時", type: "date", primary: true },
  { key: "level", label: "レベル", type: "select", options: ["情報", "警告", "エラー"] },
  { key: "stage", label: "ステージ", type: "text" },
  { key: "message", label: "内容・詳細", type: "text" },
];

export default function EventLogsPage() {
  return (
    <main style={ui.pageWide}>
      <h1 style={ui.h1}>エラー・システムログ</h1>
      <LogTable
        kind="event_logs"
        columns={COLUMNS}
        filters={filters}
        logType="event_logs"
        fileNamePrefix="エラー・システムログ"
        defaultToday
        noWrap
      />
    </main>
  );
}
