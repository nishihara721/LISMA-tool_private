// 友だち情報の一括更新(CSV)の読み取り共通ロジック。
// 見出しは「ID」「表示名」「友だち追加日時」「流入経路名」「Lステップナンバー」。
// 「ID」はこのツールの友だち一覧の「ID」。この番号で友だちを1対1に特定し、ファイルに記載のある項目だけを更新する
// (セルが空の項目は変更しない)。友だち一覧のCSV出力をそのまま編集して取り込み直すこともできる。
import { parseJstDateTime } from "./csv-client";

export type FriendImportRow = {
  idNumber: number;
  displayName?: string; // 名前の食い違い(ID違いの疑い)の確認にだけ使う。更新はしない
  addedAt?: number; // ミリ秒。導入前の友だちのみ反映される
  sourceName?: string;
  lstepNumber?: string;
};

export type FriendImportParsed = {
  rows: FriendImportRow[];
  skipped: number; // IDや日時が読み取れず、取り込み対象から外した行数
  skippedSample: string[]; // 例(「3行目」の形式)
  duplicated: number; // 同じIDが複数行あり、最後の行を使った件数
  columns: { displayName: boolean; addedAt: boolean; source: boolean; lstepNumber: boolean };
};

export function parseFriendImportRows(csvRows: string[][]): FriendImportParsed | { error: string } {
  if (csvRows.length < 2) {
    return { error: "読み取れる行がありませんでした" };
  }

  // 見出しは、前後の空白・BOM・引用符・改行を取り除いて比較する(ファイルによって混ざることがあるため)
  const header = csvRows[0].map((h) => h.replace(/^﻿/, "").replace(/[\s　"]/g, ""));
  const findCol = (names: string[]) => names.map((n) => header.indexOf(n)).find((i) => i !== -1) ?? -1;
  const idCol = findCol(["ID", "Id", "id"]);
  const nameCol = findCol(["表示名", "名前", "友だち名"]);
  const addedAtCol = findCol(["友だち追加日時", "友だち追加日", "追加日時"]);
  const sourceCol = findCol(["流入経路名", "流入経路", "登録経路"]);
  const lstepCol = findCol(["Lステップナンバー", "Lステップ番号"]);
  if (idCol === -1) {
    return { error: `見出し行に「ID」の列が見つかりませんでした(読み取った見出し: ${header.slice(0, 8).join(" / ")})` };
  }
  if (addedAtCol === -1 && sourceCol === -1 && lstepCol === -1) {
    return { error: "更新する項目の列(「友だち追加日時」「流入経路名」「Lステップナンバー」のいずれか)が見つかりませんでした" };
  }

  const byId = new Map<number, FriendImportRow>();
  let skipped = 0;
  let duplicated = 0;
  const skippedSample: string[] = [];
  const skip = (lineNo: number) => {
    skipped++;
    if (skippedSample.length < 5) skippedSample.push(`${lineNo}行目`);
  };
  csvRows.slice(1).forEach((r, i) => {
    const lineNo = i + 2;
    if (r.every((c) => (c ?? "").trim() === "")) return; // 空行は数えない
    const idText = (r[idCol] ?? "").trim();
    if (!/^\d+$/.test(idText) || Number(idText) <= 0) return skip(lineNo);
    const row: FriendImportRow = { idNumber: Number(idText) };
    if (nameCol !== -1) {
      const v = (r[nameCol] ?? "").trim();
      if (v) row.displayName = v;
    }
    if (addedAtCol !== -1) {
      const v = (r[addedAtCol] ?? "").trim();
      if (v) {
        const t = parseJstDateTime(v);
        if (t === null) return skip(lineNo);
        row.addedAt = t;
      }
    }
    if (sourceCol !== -1) {
      const v = (r[sourceCol] ?? "").trim();
      if (v) row.sourceName = v;
    }
    if (lstepCol !== -1) {
      const v = (r[lstepCol] ?? "").trim();
      if (v) row.lstepNumber = v;
    }
    if (byId.has(row.idNumber)) duplicated++;
    byId.set(row.idNumber, row);
  });

  return {
    rows: Array.from(byId.values()),
    skipped,
    skippedSample,
    duplicated,
    columns: { displayName: nameCol !== -1, addedAt: addedAtCol !== -1, source: sourceCol !== -1, lstepNumber: lstepCol !== -1 },
  };
}
