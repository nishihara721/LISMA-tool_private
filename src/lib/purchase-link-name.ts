// 広告(PurchaseLinkDoc)の「名前」を、複数の構成要素から組み立てるための共通ロジック。
// 一覧画面・APIの両方(新規登録・更新)から同じロジックを使うことで、組み立て方がずれないようにする。
// (流入経路側の src/lib/source-name.ts と同じ考え方)

export type PurchaseLinkNameParts = {
  scenario?: string; // シナリオ(表示用。数値から組み立てた「1st」「2nd」等の序数表記)
  messageCount?: number; // 通数
  other?: string; // その他
};

// 数値を英語の序数表記(1st, 2nd, 3rd, 4th, ...)に変換する。
// 11・12・13は例外的に必ず「th」になる(11th, 12th, 13th)ことに注意。
export function ordinal(n: number): string {
  const remainder100 = n % 100;
  if (remainder100 >= 11 && remainder100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

// 空欄の要素をスキップしつつ、決まった順序で「_」区切りに結合する。
// 通数は「500通目」のように単位を付けて分かりやすくする。
export function buildPurchaseLinkName(parts: PurchaseLinkNameParts): string {
  const segments = [
    parts.scenario?.trim(),
    typeof parts.messageCount === "number" && !Number.isNaN(parts.messageCount)
      ? `${parts.messageCount}通目`
      : undefined,
    parts.other?.trim(),
  ].filter((s): s is string => !!s);

  return segments.join("_");
}
