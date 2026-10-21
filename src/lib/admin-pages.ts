// 管理画面のページ一覧(ナビゲーションの構成と、ページ閲覧権限の選択肢の両方で共通して使う)。
// ここに無いpathはミドルウェアの権限チェック対象にならないため、
// 新しい管理画面ページを追加したら必ずここにも追加すること。
// externalUrl を持つエントリは、管理画面内のページではなく別URLを新しいタブで開く(権限チェック用にpathは残す)
export type AdminPageEntry = { path: string; label: string; externalUrl?: string };
export type AdminPageGroup = { label: string; children: AdminPageEntry[] };
export type AdminNavEntry = AdminPageEntry | AdminPageGroup;

// 操作マニュアルの公開URL(管理画面とは別のサイト)
export const MANUAL_URL = "https://lisma.jp/project/tool/manual";

// 管理画面のページ(path)と、対応するマニュアルのページ(<グループID>/<項目ID>.html)の対応表。
// 各ページ右上の「マニュアル」ボタンのリンク先に使う。配下のページ(例: /admin/sources/new)は、
// 前方一致で最も長く一致するものを使う。ここに無いページは、マニュアルの目次へリンクする。
// マニュアルのページを追加・変更したら(src/app/admin/manual/content.ts)、ここも合わせて更新すること。
const MANUAL_PAGE_MAP: { path: string; page: string }[] = [
  { path: "/admin/sources", page: "friends-sources/sources.html" },
  { path: "/admin/purchase-links", page: "friends-sources/purchase-links.html" },
  { path: "/admin/logs/source-link-clicks", page: "logs/source-link-clicks.html" },
  { path: "/admin/logs/clicks", page: "logs/clicks.html" },
  { path: "/admin/logs/conversions", page: "logs/conversions.html" },
  { path: "/admin/logs/events", page: "logs/events.html" },
  { path: "/admin/reports/monthly-summary", page: "reports/monthly-summary.html" },
  { path: "/admin/reports/daily-by-popup", page: "reports/daily-by-popup.html" },
  { path: "/admin/reports/daily-by-exit-point", page: "reports/daily-by-exit-point.html" },
  { path: "/admin/reports/daily-by-appeal", page: "reports/daily-by-appeal.html" },
  { path: "/admin/reports/daily-by-scenario", page: "reports/daily-by-scenario.html" },
  { path: "/admin/reports/daily", page: "reports/daily.html" },
  { path: "/admin/reports/ad-metrics-import", page: "data/ad-metrics-import.html" },
  { path: "/admin/reports/cv-log", page: "data/cv-log.html" },
  { path: "/admin/users", page: "admin/users.html" },
];

// 表示中のページ(pathname)に対応するマニュアルのURLを返す
// レポート閲覧権限のユーザー向けマニュアルは、「user」ディレクトリ配下に同じ構成で置かれている
// (例: https://lisma.jp/project/tool/manual/user/reports/monthly-summary.html)。
export function manualBaseUrl(role?: string): string {
  return role === "report_viewer" ? `${MANUAL_URL}/user` : MANUAL_URL;
}

export function manualUrlFor(pathname: string, role?: string): string {
  const base = manualBaseUrl(role);
  if (pathname === "/admin") return `${base}/friends-sources/friends.html`;
  const hit = MANUAL_PAGE_MAP.filter((m) => pathname === m.path || pathname.startsWith(`${m.path}/`)).sort(
    (a, b) => b.path.length - a.path.length
  )[0];
  return hit ? `${base}/${hit.page}` : `${base}/index.html`;
}

export function isAdminPageGroup(entry: AdminNavEntry): entry is AdminPageGroup {
  return "children" in entry;
}

// 「管理者権限」ロールのユーザー管理機能以外の、通常のナビゲーション構成。
// src/app/admin/layout.tsx のサイドメニューの描画と、
// 「レポート閲覧権限」ユーザーの閲覧可能ページ選択(src/app/admin/users)の両方で使う。
export const ADMIN_NAV_ITEMS: AdminNavEntry[] = [
  { path: "/admin", label: "友だち一覧" },
  { path: "/admin/sources", label: "流入経路管理" },
  { path: "/admin/purchase-links", label: "広告管理" },
  {
    label: "ログ集計",
    children: [
      { path: "/admin/logs/source-link-clicks", label: "流入経路ログ" },
      { path: "/admin/logs/clicks", label: "広告クリックログ" },
      { path: "/admin/logs/conversions", label: "広告成果ログ" },
      { path: "/admin/logs/events", label: "エラー・システムログ" },
    ],
  },
  {
    label: "レポート集計",
    children: [
      { path: "/admin/reports/monthly-summary", label: "サマリ" },
      { path: "/admin/reports/daily", label: "日次・月次レポート" },
      { path: "/admin/reports/daily-by-popup", label: "ポップアップ別" },
      { path: "/admin/reports/daily-by-exit-point", label: "離脱地点別" },
      { path: "/admin/reports/daily-by-appeal", label: "訴求別" },
      { path: "/admin/reports/daily-by-scenario", label: "シナリオ別" },
    ],
  },
  {
    label: "データ",
    children: [
      { path: "/admin/reports/ad-metrics-import", label: "データ取り込み" },
      { path: "/admin/reports/cv-log", label: "編集用成果ログ" },
    ],
  },
  { path: "/admin/manual", label: "マニュアル", externalUrl: MANUAL_URL },
];

// ユーザー管理ページ。管理者権限のユーザーにのみ表示する(閲覧権限の選択肢には含めない)。
export const ADMIN_USERS_PAGE: AdminPageEntry = { path: "/admin/users", label: "ユーザー管理" };

// 上記のナビ構成を、権限チェック用にフラットな一覧へ変換したもの。
export const ADMIN_PAGES: AdminPageEntry[] = ADMIN_NAV_ITEMS.flatMap((entry) =>
  isAdminPageGroup(entry) ? entry.children : [entry]
);

// 「レポート閲覧権限」ユーザーに割り当てられる、閲覧可能ページの選択肢。
// 日次・月次レポート(合算。同じページ内で切り替え)・日次4レポート・月次サマリの合計6つのレポートに加え、
// 広告クリックログ・広告成果ログを対象とする(閲覧用では友だち名は非表示)。
// (友だち一覧・流入経路管理・その他のログ・データ取り込み等は、レポート閲覧権限では選択できない)。
export const REPORT_VIEWER_SELECTABLE_PAGES: AdminPageEntry[] = [
  { path: "/admin/reports/daily", label: "日次・月次レポート" },
  { path: "/admin/reports/daily-by-popup", label: "ポップアップ別" },
  { path: "/admin/reports/daily-by-exit-point", label: "離脱地点別" },
  { path: "/admin/reports/daily-by-appeal", label: "訴求別" },
  { path: "/admin/reports/daily-by-scenario", label: "シナリオ別" },
  { path: "/admin/reports/monthly-summary", label: "サマリ" },
  { path: "/admin/logs/clicks", label: "広告クリックログ" },
  { path: "/admin/logs/conversions", label: "広告成果ログ" },
];

// pathが、指定したページ(またはその配下の新規作成・編集ページ等)に該当するかどうか。
// 例: allowedPage="/admin/sources" は "/admin/sources/new" にもマッチする。
export function pathMatchesAdminPage(pathname: string, pagePath: string): boolean {
  return pathname === pagePath || pathname.startsWith(`${pagePath}/`);
}
