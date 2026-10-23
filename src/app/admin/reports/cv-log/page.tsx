import * as ui from "../../ui";
import LogTable, { type Column, type FilterDef } from "../../logs/LogTable";
import CvLogToolsPanel from "./CvLogToolsPanel";
import { getPurchaseLinkNameOptions, getSourceNameOptions } from "@/lib/filter-options";

export const dynamic = "force-dynamic";

// 編集用成果ログ。他のログ画面と同じ、サーバー側でページごとに取得する方式(src/lib/log-tables.ts の cv_log)。
// 自動計測の成果と手動追加の成果を合わせて、非表示のものも含めて表示する。
const COLUMNS: Column[] = [
  { key: "convertedAt", label: "成果日時" },
  { key: "friend", label: "友だち名" },
  { key: "source", label: "流入経路" },
  { key: "purchaseLink", label: "広告" },
  { key: "note", label: "メモ" },
  { key: "kind", label: "種別" },
  { key: "status", label: "状態" },
  { key: "rowId", label: "ID", render: "code" },
];

export default async function CvLogEditPage() {
  const [sourceOptions, purchaseLinkOptions] = await Promise.all([getSourceNameOptions(), getPurchaseLinkNameOptions()]);
  const filters: FilterDef[] = [
    { key: "convertedAt", label: "成果日時", type: "date", primary: true },
    { key: "userName", label: "友だち名", type: "text" },
    { key: "source", label: "流入経路", type: "multiselect", options: sourceOptions },
    { key: "purchaseLink", label: "広告", type: "multiselect", options: purchaseLinkOptions },
    { key: "kind", label: "種別", type: "select", options: ["自動計測", "インポート"] },
    { key: "status", label: "状態", type: "select", options: ["表示中", "非表示"] },
  ];

  return (
    <main style={ui.pageWide}>
      <h1 style={ui.h1}>編集用成果ログ</h1>
      <CvLogToolsPanel />
      <LogTable
        kind="cv_log"
        columns={COLUMNS}
        filters={filters}
        logType="cv_log"
        fileNamePrefix="編集用成果ログ"
        defaultToday
        noWrap
        cvEdit
      />
    </main>
  );
}
