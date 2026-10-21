"use client";

import * as ui from "./ui";

// 「前の50件 / 次の50件」と、現在のページ(全ページ数が分かる場合は「現在 / 全ページ数」)を出すページ送り。
// 全ページ数を数えるとFirestoreの読み取りが増えるため、サーバー側でページ送りする画面(友だち一覧・各ログ)では
// totalPages を渡さず、「N ページ目」だけを表示する。
export default function Pager({
  page, // 現在のページ(1始まり)
  totalPages,
  pageSize,
  hasPrev,
  hasNext,
  loading = false,
  onPrev,
  onNext,
}: {
  page: number;
  totalPages?: number;
  pageSize: number;
  hasPrev: boolean;
  hasNext: boolean;
  loading?: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "10px 0", flexWrap: "wrap" }}>
      <button type="button" style={ui.buttonSmall} onClick={onPrev} disabled={!hasPrev || loading}>
        ← 前の{pageSize}件
      </button>
      <span style={{ fontSize: 13 }}>
        {totalPages === undefined ? `${page}ページ目` : `${page} / ${totalPages}ページ`}
      </span>
      <button type="button" style={ui.buttonSmall} onClick={onNext} disabled={!hasNext || loading}>
        次の{pageSize}件 →
      </button>
    </div>
  );
}
