// 管理画面全体で使い回す見た目(フォントサイズ・余白)の共通定義。
// ページごとにバラバラな値を書くのを避けるため、ここにまとめている。
import type { CSSProperties } from "react";

export const page: CSSProperties = {
  padding: "32px 40px",
  maxWidth: 960,
};

export const pageWide: CSSProperties = {
  padding: "32px 40px",
};

export const h1: CSSProperties = {
  fontSize: 22,
  fontWeight: 600,
  margin: "0 0 24px", // 各ページの説明文を置かないため、見出しと本文の間隔をここで確保する
  color: "#111827",
};

export const h2: CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
  margin: "0 0 16px",
  color: "#111827",
};

export const lead: CSSProperties = {
  color: "#6b7280",
  fontSize: 13.5,
  margin: "0 0 24px",
  lineHeight: 1.7,
};

export const headerRow: CSSProperties = {
  // タイトルの右隣に「＋ 新規登録」などのボタンを並べる行(右端はマニュアルボタン用に空けておく)
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-start",
  gap: 16,
  marginBottom: 24,
};

export const backLink: CSSProperties = {
  display: "inline-block",
  fontSize: 13,
  color: "#6b7280",
  textDecoration: "none",
  marginBottom: 16,
};

export const section: CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  background: "#ffffff",
  padding: 24,
  marginBottom: 32,
};

export const field: CSSProperties = {
  marginBottom: 16,
};

export const label: CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 500,
  color: "#374151",
  marginBottom: 6,
};

export const input: CSSProperties = {
  padding: "8px 10px",
  fontSize: 14,
  border: "1px solid #d1d5db",
  borderRadius: 6,
  width: "100%",
  maxWidth: 420,
};

export const hint: CSSProperties = {
  fontSize: 12,
  color: "#8b94a3",
  margin: "6px 0 0",
  lineHeight: 1.6,
};

// ログ画面(クリックログ・成果ログ)上部の絞り込み検索バー
export const filterBar: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "flex-end",
  gap: 16,
  marginBottom: 20,
  padding: 16,
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  background: "#ffffff",
};

export const filterField: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

export const filterLabel: CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: "#6b7280",
};

export const filterInput: CSSProperties = {
  padding: "6px 8px",
  fontSize: 13,
  border: "1px solid #d1d5db",
  borderRadius: 6,
  minWidth: 140,
};

export const filterSelect: CSSProperties = {
  ...filterInput,
  minWidth: 160,
};

export const filterResultCount: CSSProperties = {
  fontSize: 12.5,
  color: "#8b94a3",
  margin: "0 0 10px",
};

// 項目(見出し行)は固定し、中身だけスクロールさせるための外枠。
// 高さを指定して overflowY: auto にし、thead を sticky にすることで実現している。
export const tableScroll: CSSProperties = {
  maxHeight: "calc(100vh - 260px)",
  overflowY: "auto",
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  background: "#ffffff",
};

export const table: CSSProperties = {
  borderCollapse: "collapse",
  width: "100%",
};

export const th: CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 1,
  textAlign: "left",
  fontSize: 12.5,
  fontWeight: 600,
  color: "#6b7280",
  background: "#f8fafc",
  borderBottom: "1px solid #e5e7eb",
  padding: "10px 14px",
  whiteSpace: "nowrap",
};

export const td: CSSProperties = {
  borderBottom: "1px solid #f0f2f5",
  padding: "12px 14px",
  verticalAlign: "middle",
};

const buttonBase: CSSProperties = {
  padding: "8px 16px",
  fontSize: 13.5,
  borderRadius: 6,
  border: "1px solid #d1d5db",
  background: "#ffffff",
  color: "#374151",
};

export const button: CSSProperties = buttonBase;

export const buttonPrimary: CSSProperties = {
  ...buttonBase,
  background: "#3f8fb8",
  borderColor: "#3f8fb8",
  color: "#ffffff",
  fontWeight: 500,
};

export const buttonDanger: CSSProperties = {
  ...buttonBase,
  color: "#c0392b",
  borderColor: "#f0d4d0",
};

export const buttonSmall: CSSProperties = {
  ...buttonBase,
  padding: "5px 10px",
  fontSize: 12.5,
};

// 「編集」をテキストボタンではなくアイコンボタンにする場合の見た目(ポップアップ別等の比較レポートで使用)。
export const iconButton: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 26,
  height: 26,
  padding: 0,
  borderRadius: 6,
  border: "1px solid #d1d5db",
  background: "#ffffff",
  color: "#4b5563",
  cursor: "pointer",
};

// 「ポップアップ別」等、複数のグループを横に並べて比較するレポート用の、1枚にまとめたテーブルのスタイル。
// 日付(月)列を左端に固定し、その他の列はグループごとにまとまったまま縦スクロールが揃うようにする
// (以前のような、グループごとに別テーブル・別スクロール領域にする作りをやめ、1つのテーブル・1つの
// スクロール領域にして、日付列の固定と縦スクロールの連動を素直に実現している)。
export const compareTableScroll: CSSProperties = {
  maxHeight: "calc(100vh - 260px)",
  overflow: "auto",
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  background: "#ffffff",
};

export const compareTable: CSSProperties = {
  borderCollapse: "collapse",
  fontSize: 12.5,
};

// グループ名を表示する1段目の見出し行(colSpanでそのグループの列数分まとめる)
export const compareGroupTh: CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 3,
  textAlign: "center",
  fontSize: 12,
  fontWeight: 600,
  color: "#374151",
  background: "#eef3f6",
  borderBottom: "1px solid #e5e7eb",
  borderLeft: "1px solid #e5e7eb",
  padding: "7px 8px",
  whiteSpace: "nowrap",
};

// 指標名を表示する2段目の見出し行
export const compareMetricTh: CSSProperties = {
  position: "sticky",
  zIndex: 2,
  textAlign: "right",
  fontSize: 11.5,
  fontWeight: 600,
  color: "#6b7280",
  background: "#f8fafc",
  borderBottom: "1px solid #e5e7eb",
  padding: "6px 8px",
  whiteSpace: "nowrap",
};

// 左端の日付(月)列の見出しセル(縦・横どちらにスクロールしても常に見えるよう、上下左右とも固定する)
export const compareDateCornerTh: CSSProperties = {
  position: "sticky",
  top: 0,
  left: 0,
  zIndex: 4,
  textAlign: "left",
  fontSize: 12,
  fontWeight: 600,
  color: "#6b7280",
  background: "#f8fafc",
  borderBottom: "1px solid #e5e7eb",
  padding: "7px 10px",
  whiteSpace: "nowrap",
};

// 左端の日付(月)列のデータセル(横スクロールしても常に見えるよう左に固定する)
export const compareDateTd: CSSProperties = {
  position: "sticky",
  left: 0,
  zIndex: 1,
  background: "#ffffff",
  borderBottom: "1px solid #f0f2f5",
  borderRight: "1px solid #e5e7eb",
  padding: "8px 10px",
  whiteSpace: "nowrap",
  fontWeight: 500,
};

export const compareTd: CSSProperties = {
  borderBottom: "1px solid #f0f2f5",
  padding: "8px 8px",
  textAlign: "right",
  whiteSpace: "nowrap",
};

// 隣り合うグループ(ポップアップ・シナリオ等)の境目を分かりやすくするための縦線。
// 各グループの最初の列(th/td)にだけ適用する。
export const compareGroupDividerBorder = "2px solid #c7ced6";

// 「現在稼働中」の名前を目立たせるための見た目(チェックボックスの選択肢・テーブルの見出しで使う)。
export const activeLabelText: CSSProperties = {
  fontWeight: 700,
  color: "#0f766e",
};

export const activeLabelBadge: CSSProperties = {
  display: "inline-block",
  fontSize: 10.5,
  fontWeight: 600,
  color: "#0f766e",
  background: "#d1fae5",
  borderRadius: 999,
  padding: "1px 7px",
  marginLeft: 6,
  verticalAlign: "middle",
};

export const code: CSSProperties = {
  fontSize: 11.5,
  background: "#f4f6f8",
  padding: "3px 6px",
  borderRadius: 4,
  wordBreak: "break-all",
};
