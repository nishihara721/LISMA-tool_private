// LステップからエクスポートしたCSV/Excel(友だち一覧)から、
// 「ID」(Lステップナンバー)・「表示名」・「友だち追加日時」の3列を読み取るための共通ロジック。
import { parseJstDateTime } from "./csv-client";

// sourceName は任意の列(「流入経路名」「流入経路」「登録経路」のいずれか)。導入前の友だちの流入経路の更新に使う。
export type LstepImportRow = { displayName: string; addedAt: number; lstepNumber: string; sourceName?: string };

export function parseLstepRows(csvRows: string[][]): LstepImportRow[] | { error: string } {
  if (csvRows.length < 2) {
    return { error: "読み取れる行がありませんでした" };
  }

  // 見出しは、前後の空白・BOM・引用符・改行を取り除いて比較する(ファイルによって混ざることがあるため)
  const header = csvRows[0].map((h) => h.replace(/^\uFEFF/, "").replace(/[\s\u3000"]/g, ""));
  const findCol = (names: string[]) => names.map((n) => header.indexOf(n)).find((i) => i !== -1) ?? -1;
  const idCol = findCol(["ID", "Id", "id"]);
  const nameCol = findCol(["表示名", "名前", "友だち名"]);
  const addedAtCol = findCol(["友だち追加日時", "友だち追加日", "追加日時"]);
  const sourceCol = findCol(["流入経路名", "流入経路", "登録経路"]);
  if (idCol === -1 || nameCol === -1 || addedAtCol === -1) {
    return { error: `見出し行に「ID」「表示名」「友だち追加日時」の列が見つかりませんでした(読み取った見出し: ${header.slice(0, 8).join(" / ")})` };
  }

  const rows: LstepImportRow[] = [];
  csvRows.slice(1).forEach((r) => {
    const lstepNumber = (r[idCol] ?? "").trim();
    const displayName = (r[nameCol] ?? "").trim();
    const addedAt = parseJstDateTime(r[addedAtCol] ?? "");
    if (!lstepNumber || !displayName || addedAt === null) return; // 読み取れない行はスキップ
    const sourceName = sourceCol === -1 ? "" : (r[sourceCol] ?? "").trim();
    rows.push(sourceName ? { displayName, addedAt, lstepNumber, sourceName } : { displayName, addedAt, lstepNumber });
  });

  return rows;
}
