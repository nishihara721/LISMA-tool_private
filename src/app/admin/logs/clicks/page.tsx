import { cookies } from "next/headers";
import * as ui from "../../ui";
import { ADMIN_SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import LogTable, { type Column, type FilterDef } from "../LogTable";
import { getPurchaseLinkNameOptions, getSourceNameOptions } from "@/lib/filter-options";

export const dynamic = "force-dynamic";

const COLUMNS: Column[] = [
  { key: "clickedAt", label: "クリック日時" },
  { key: "purchaseLink", label: "広告" },
  { key: "idNumber", label: "ID" },
  { key: "friend", label: "友だち名" },
  { key: "original", label: "友だち追加時の流入経路" },
  { key: "latest", label: "最新の流入経路" },
  { key: "clickId", label: "clickId", render: "code" },
];

export default async function ClicksLogPage() {
  // レポート閲覧権限のユーザーには、友だち名の列とユーザー名での絞り込みを表示しない
  const session = await verifySessionToken((await cookies()).get(ADMIN_SESSION_COOKIE)?.value);
  const hideFriendName = session?.role !== "admin";
  const [sourceOptions, purchaseLinkOptions] = await Promise.all([getSourceNameOptions(), getPurchaseLinkNameOptions()]);

  const allFilters: FilterDef[] = [
    { key: "clickedAt", label: "クリック日時", type: "date", primary: true },
    { key: "userName", label: "ユーザー名", type: "text" },
    { key: "originalSource", label: "友だち追加時の流入経路", type: "multiselect", options: sourceOptions },
    { key: "latestSource", label: "最新の流入経路", type: "multiselect", options: sourceOptions },
    { key: "purchaseLink", label: "広告", type: "multiselect", options: purchaseLinkOptions },
  ];
  const filters = hideFriendName ? allFilters.filter((f) => f.key !== "userName") : allFilters;
  const columns = hideFriendName ? COLUMNS.filter((c) => c.key !== "friend") : COLUMNS;

  return (
    <main style={ui.pageWide}>
      <h1 style={ui.h1}>広告クリックログ</h1>
      <LogTable
        kind="purchase_clicks"
        columns={columns}
        filters={filters}
        logType="purchase_clicks"
        fileNamePrefix="広告クリックログ"
        defaultToday
        noWrap
      />
    </main>
  );
}
