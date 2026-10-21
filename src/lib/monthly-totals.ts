// 各レポート画面の「月ごとの総計行」で共通して使う、月の判定・並び替えロジック。
//
// 総計行の位置は、日付の並び順によって変える:
//   - 昇順(古い→新しい): その月の最後(月末)の行の直後に総計行を置く
//   - 降順(新しい→古い): その月の最初(月末。降順では月末の日付が先頭に来るため)の行の「前」に総計行を置く
// つまりどちらの並び順でも、総計行は常にその月の「先頭」(画面の上側)に来るようにしている。

export function monthKeyOf(date: string): string {
  return date.slice(0, 7); // "YYYY-MM-DD" → "YYYY-MM"
}

// 年月(YYYY-MM)を、画面表示用の「YYYY年M月」の形式にする
export function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-");
  return `${year}年${Number(month)}月`;
}

export type MonthlyDisplayItem<TRow, TTotals> =
  | { kind: "row"; row: TRow }
  | { kind: "total"; monthKey: string; totals: TTotals };

// 日付順(昇順・降順いずれか一方)にすでに並んでいる行の配列を、月ごとにグループ化し、
// 各グループの前後どちらかに総計行を挿入した表示用の配列を返す。
// sortedRowsは同じ月の行が必ず連続している(日付で完全にソートされている)前提。
export function buildMonthlyDisplayItems<TRow, TTotals>(
  sortedRows: TRow[],
  getDate: (row: TRow) => string,
  sortOrder: "asc" | "desc",
  computeTotals: (rowsInMonth: TRow[]) => TTotals
): MonthlyDisplayItem<TRow, TTotals>[] {
  const items: MonthlyDisplayItem<TRow, TTotals>[] = [];
  let i = 0;
  while (i < sortedRows.length) {
    const key = monthKeyOf(getDate(sortedRows[i]));
    const group: TRow[] = [];
    let j = i;
    while (j < sortedRows.length && monthKeyOf(getDate(sortedRows[j])) === key) {
      group.push(sortedRows[j]);
      j++;
    }
    const totals = computeTotals(group);
    if (sortOrder === "desc") {
      items.push({ kind: "total", monthKey: key, totals });
      group.forEach((row) => items.push({ kind: "row", row }));
    } else {
      group.forEach((row) => items.push({ kind: "row", row }));
      items.push({ kind: "total", monthKey: key, totals });
    }
    i = j;
  }
  return items;
}
