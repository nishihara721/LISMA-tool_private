// PV数集計ツールからエクスポートしたCSV/Excel(日付ごとの行)から、日次レポートに取り込む
// PV数を読み取るための共通ロジック。見出し行に「日付」「合計」の2列が必要
// (「合計」列の値をその日のPV数としてそのまま使う。列の並び順は自動判定するため問わない)。
import { parseJstDateKey } from "./csv-client";

export type PvImportRow = { date: string; pvCount: number };

export function parsePvRows(csvRows: string[][]): PvImportRow[] | { error: string } {
  if (csvRows.length < 2) {
    return { error: "読み取れる行がありませんでした" };
  }

  const header = csvRows[0];
  const dateCol = header.indexOf("日付");
  const totalCol = header.indexOf("合計");
  if (dateCol === -1 || totalCol === -1) {
    return { error: "見出し行に「日付」「合計」の列が見つかりませんでした" };
  }

  const byDate = new Map<string, number>();
  csvRows.slice(1).forEach((r) => {
    const dateKey = parseJstDateKey(r[dateCol] ?? "");
    if (!dateKey) return; // 日付が読み取れない行はスキップ
    const pvCount = Number(r[totalCol] ?? 0) || 0;
    byDate.set(dateKey, (byDate.get(dateKey) ?? 0) + pvCount);
  });

  return Array.from(byDate.entries()).map(([date, pvCount]) => ({ date, pvCount }));
}

// 訴求別レポート用のPV数取り込み。上のparsePvRowsとは異なり「横持ち」形式で、
// 「日付」列の他に、訴求ごとに1列(その列の見出しセル自体が具体的な訴求名になっている)を持つ表を想定する。
// 例: 日付 | スキンケア訴求 | 美容訴求 | ... という見出し行で、各セルにその日・その訴求のPV数を入れる。
// セルが空欄の(日付, 訴求)の組み合わせは、その訴求のPV数が未計測として取り込み対象から除外する。
export type AppealPvImportRow = { date: string; appeal: string; pvCount: number };

export function parseAppealPvRows(csvRows: string[][]): AppealPvImportRow[] | { error: string } {
  if (csvRows.length < 2) {
    return { error: "読み取れる行がありませんでした" };
  }

  const header = csvRows[0];
  const dateCol = header.indexOf("日付");
  if (dateCol === -1) {
    return { error: "見出し行に「日付」の列が見つかりませんでした" };
  }

  const appealCols = header
    .map((h, i) => ({ appeal: (h ?? "").toString().trim(), i }))
    .filter(({ appeal, i }) => i !== dateCol && appeal !== "");
  if (appealCols.length === 0) {
    return { error: "見出し行に訴求名の列が見つかりませんでした(「日付」以外に、訴求名そのものを見出しにした列が必要です)" };
  }

  const rows: AppealPvImportRow[] = [];
  csvRows.slice(1).forEach((r) => {
    const dateKey = parseJstDateKey(r[dateCol] ?? "");
    if (!dateKey) return; // 日付が読み取れない行はスキップ
    appealCols.forEach(({ appeal, i }) => {
      const raw = (r[i] ?? "").toString().trim();
      if (raw === "") return; // 空欄はその訴求のPV数が未計測として扱う
      const pvCount = Number(raw);
      if (Number.isNaN(pvCount)) return;
      rows.push({ date: dateKey, appeal, pvCount });
    });
  });

  return rows;
}
