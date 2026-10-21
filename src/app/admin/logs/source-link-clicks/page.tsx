import * as ui from "../../ui";
import LogTable, { type Column, type FilterDef } from "../LogTable";
import { getSourceNameOptions } from "@/lib/filter-options";

export const dynamic = "force-dynamic";

const COLUMNS: Column[] = [
  { key: "clickedAt", label: "クリック日時" },
  { key: "clicked", label: "クリックした流入経路" },
  { key: "original", label: "友だち追加時の流入経路" },
  { key: "idNumber", label: "ID" },
  { key: "friend", label: "友だち名" },
  { key: "status", label: "状態" },
  { key: "clickId", label: "clickId", render: "code" },
];

export default async function SourceLinkClicksLogPage() {
  const sourceOptions = await getSourceNameOptions(["直接追加", "(未特定)", "(記録なし)"]);

  const filters: FilterDef[] = [
    { key: "clickedAt", label: "クリック日時", type: "date", primary: true },
    { key: "userName", label: "ユーザー名", type: "text" },
    { key: "clickedSource", label: "クリックした流入経路", type: "multiselect", options: sourceOptions },
    { key: "originalSource", label: "友だち追加時の流入経路", type: "multiselect", options: sourceOptions },
  ];

  return (
    <main style={ui.pageWide}>
      <h1 style={ui.h1}>流入経路ログ</h1>
      <LogTable
        kind="source_link_clicks"
        columns={COLUMNS}
        filters={filters}
        logType="source_link_clicks"
        fileNamePrefix="流入経路ログ"
        defaultToday
        noWrap
      />
    </main>
  );
}
