// 請求額などの金額を「12,345円」の形式で表示するための共通関数。
export function formatYen(amount: number): string {
  return `${Math.round(amount).toLocaleString("ja-JP")}円`;
}
