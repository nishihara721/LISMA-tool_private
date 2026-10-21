// 絞り込みのプルダウン(流入経路・広告)に出す選択肢。
// ページネーションにより画面に読み込んだ行だけでは選択肢が足りなくなるため、設定(流入経路・広告)から作る。
import { getAllPurchaseLinks, getAllSources } from "./settings-cache";

export async function getSourceNameOptions(extra: string[] = ["直接追加", "(未特定)"]): Promise<string[]> {
  const sources = await getAllSources();
  return Array.from(new Set([...sources.map((s) => s.name), ...extra])).sort();
}

export async function getPurchaseLinkNameOptions(): Promise<string[]> {
  const links = await getAllPurchaseLinks();
  return Array.from(new Set(links.map((p) => p.name))).sort();
}
