// Lステップナンバーの取り込みで、CSVの「友だち追加日時」の最小〜最大から、突合の対象にする期間を求める共通ロジック。
// 画面(対象期間の表示)とサーバー(友だちの読み込み範囲)の両方で同じ計算を使う。

// 友だちを読み込む件数の上限。これを超える期間は「期間を分けて取り込んでください」として実行しない。
export const LSTEP_IMPORT_MAX_FRIENDS = 10000;
// CSVの行数の上限(1回のリクエストの大きさを抑えるため)
export const LSTEP_IMPORT_MAX_ROWS = 20000;

const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

// LステップとこのツールでLINEの追加日時が数秒〜数分ずれても拾えるよう、CSVの最小〜最大の前後に1日ずつ余裕を持たせる
export function lstepImportRange(addedAts: number[]): { from: number; to: number; minAt: number; maxAt: number } {
  let minAt = Infinity;
  let maxAt = -Infinity;
  addedAts.forEach((t) => {
    if (t < minAt) minAt = t;
    if (t > maxAt) maxAt = t;
  });
  return { from: minAt - DAY_MS, to: maxAt + DAY_MS, minAt, maxAt };
}

// 画面に出す対象期間の表記(日本時間)。例: 「2026/09/01〜09/30」「2025/12/20〜2026/01/05」
export function formatLstepPeriod(minAt: number, maxAt: number): string {
  const ymd = (t: number) => new Date(t + JST_OFFSET_MS).toISOString().slice(0, 10).split("-");
  const [y1, m1, d1] = ymd(minAt);
  const [y2, m2, d2] = ymd(maxAt);
  const start = `${y1}/${m1}/${d1}`;
  const end = y1 === y2 ? `${m2}/${d2}` : `${y2}/${m2}/${d2}`;
  return `${start}〜${end}`;
}
