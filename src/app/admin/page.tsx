import * as ui from "./ui";
import LogTable, { type Column, type FilterDef } from "./logs/LogTable";
import { getSourceNameOptions } from "@/lib/filter-options";
import FriendToolsPanel from "./FriendToolsPanel";

export const dynamic = "force-dynamic";

const COLUMNS: Column[] = [
  { key: "idNumber", label: "ID" },
  { key: "displayName", label: "表示名" },
  { key: "lineUserId", label: "LINEユーザーID" },
  { key: "lstepNumber", label: "Lステップナンバー" },
  { key: "source", label: "流入経路" },
  { key: "addedAt", label: "友だち追加日時" },
  { key: "cvCount", label: "購入回数" },
  { key: "status", label: "状態" },
  { key: "preExisting", label: "導入前" },
];

export default async function AdminFriendsPage() {
  const sourceOptions = await getSourceNameOptions(["直接追加"]);

  const filters: FilterDef[] = [
    { key: "userName", label: "ユーザー名", type: "text" },
    { key: "lineUserId", label: "LINEユーザーID", type: "text" },
    { key: "source", label: "流入経路", type: "multiselect", options: sourceOptions },
    { key: "addedAt", label: "友だち追加日時", type: "date", primary: true },
    { key: "status", label: "友だち状態", type: "select", options: ["友だち", "ブロック/解除済"] },
    { key: "preExisting", label: "導入前の友だち", type: "select", options: ["導入前", "通常"] },
    { key: "lstep", label: "Lステップナンバー", type: "select", options: ["付与済み", "未付与"] },
  ];

  return (
    <main style={ui.pageWide}>
      <h1 style={ui.h1}>友だち一覧</h1>
      <FriendToolsPanel />
      <LogTable kind="friends" columns={COLUMNS} filters={filters} logType="friends" fileNamePrefix="友だち一覧" />
    </main>
  );
}
