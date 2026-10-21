// メモ欄の文章を「通常の文字」と「リンク」に分解する。
//   表示名(https://example.com/...)  … 表示名がリンク文字になる(半角( )・全角（ ）どちらも可)
//   https://example.com/...          … URLそのものがリンク文字になる
// 「表示名」は、直前の空白・改行・括弧までの続けて書かれた文字。文章の途中に置く場合は、表示名の前に空白か改行を入れる。
// リンクにするのは http:// と https:// のみ(javascript: 等は無視して通常の文字として表示する)。
export type MemoSegment = { type: "text"; text: string } | { type: "link"; text: string; href: string };

const URL_CHARS = "[A-Za-z0-9\\-._~:/?#\\[\\]@!$&'*+,;=%]+";
const MEMO_LINK_RE = new RegExp(
  `([^\\s()（）]+)?[(（](https?://${URL_CHARS})[)）]|https?://${URL_CHARS}`,
  "g"
);

export const MEMO_MAX_LENGTH = 2000;

export function parseMemo(memo: string): MemoSegment[] {
  const segments: MemoSegment[] = [];
  let last = 0;
  for (const m of memo.matchAll(MEMO_LINK_RE)) {
    const start = m.index ?? 0;
    if (start > last) segments.push({ type: "text", text: memo.slice(last, start) });
    if (m[2]) segments.push({ type: "link", text: m[1] ?? m[2], href: m[2] });
    else segments.push({ type: "link", text: m[0], href: m[0] });
    last = start + m[0].length;
  }
  if (last < memo.length) segments.push({ type: "text", text: memo.slice(last) });
  return segments;
}
