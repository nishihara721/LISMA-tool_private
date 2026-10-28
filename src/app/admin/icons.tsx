// 管理画面で使い回す小さなアイコン(主に「編集」ボタンをテキストからアイコンに置き換えるためのもの)。
export function EditPencilIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M13.5 3.5L16.5 6.5L7 16H4V13L13.5 3.5Z" />
    </svg>
  );
}

// サイドメニューで使うアイコン(ページごとに1つ。サイドメニューを閉じたときに、アイコンだけでページが分かるようにする)。
const NAV_ICON_PATHS: Record<string, React.ReactNode> = {
  users: (
    <>
      <circle cx="10" cy="7" r="3" />
      <path d="M4 16c0-3 2.7-5 6-5s6 2 6 5" />
    </>
  ),
  link: <path d="M8.5 11.5l3-3M7 9L5.5 10.5a2.5 2.5 0 003.5 3.5l1.5-1.5M13 11l1.5-1.5a2.5 2.5 0 00-3.5-3.5L9.5 7.5" />,
  cart: (
    <>
      <path d="M3 4h2l1.6 8h8l1.4-6H6" />
      <circle cx="8" cy="15.5" r="1" />
      <circle cx="14" cy="15.5" r="1" />
    </>
  ),
  cursor: <path d="M5 3l10 5-4.2 1.6L9 14 5 3z" />,
  check: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M6.8 10.2l2.2 2.2 4.2-4.4" />
    </>
  ),
  alert: <path d="M10 3L18 16H2L10 3zM10 8v4M10 14h.01" />,
  chart: <path d="M4 16V9M10 16V4M16 16v-6" />,
  calendar: (
    <>
      <rect x="3" y="4" width="14" height="13" rx="2" />
      <path d="M3 8h14M7 2.5v3M13 2.5v3" />
    </>
  ),
  window: (
    <>
      <rect x="3" y="4" width="14" height="12" rx="2" />
      <path d="M3 8h14" />
    </>
  ),
  exit: <path d="M8 4H5a1 1 0 00-1 1v10a1 1 0 001 1h3M12 7l3 3-3 3M15 10H8" />,
  target: (
    <>
      <circle cx="10" cy="10" r="7" />
      <circle cx="10" cy="10" r="3.5" />
      <circle cx="10" cy="10" r="0.8" />
    </>
  ),
  flow: (
    <>
      <circle cx="5" cy="5" r="2" />
      <circle cx="15" cy="14" r="2" />
      <path d="M5 7v3a3 3 0 003 3h5" />
    </>
  ),
  upload: <path d="M10 13V4M6.5 7.5L10 4l3.5 3.5M4 14v2h12v-2" />,
  edit: <path d="M13.5 3.5L16.5 6.5L7 16H4V13L13.5 3.5Z" />,
  book: <path d="M4 4.5C6 3.5 8 3.5 10 5c2-1.5 4-1.5 6-.5V16c-2-1-4-1-6 .5C8 15 6 15 4 16V4.5zM10 5v11" />,
  shield: <path d="M10 3l6 2v5c0 3.5-2.5 6-6 7-3.5-1-6-3.5-6-7V5l6-2z" />,
  tag: <path d="M3 3h7l7 7-7 7-7-7V3zM7 7h.01" />,
  menu: <path d="M4 6h12M4 10h12M4 14h12" />,
  chevronLeft: <path d="M12 5l-5 5 5 5" />,
  chevronRight: <path d="M8 5l5 5-5 5" />,
};

export type NavIconName = keyof typeof NAV_ICON_PATHS;

export function NavIcon({ name, size = 18 }: { name: NavIconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {NAV_ICON_PATHS[name]}
    </svg>
  );
}

// ページのpath → アイコン名
export const NAV_ICON_BY_PATH: Record<string, NavIconName> = {
  "/admin": "users",
  "/admin/sources": "link",
  "/admin/purchase-links": "cart",
  "/admin/logs/source-link-clicks": "cursor",
  "/admin/logs/clicks": "target",
  "/admin/logs/conversions": "check",
  "/admin/logs/events": "alert",
  "/admin/reports/monthly-summary": "chart",
  "/admin/reports/daily": "calendar",
  "/admin/reports/daily-by-popup": "window",
  "/admin/reports/daily-by-exit-point": "exit",
  "/admin/reports/daily-by-appeal": "tag",
  "/admin/reports/daily-by-scenario": "flow",
  "/admin/reports/ad-metrics-import": "upload",
  "/admin/reports/cv-log": "edit",
  "/admin/manual": "book",
  "/admin/users": "shield",
};

// 親メニュー(グループ)のアイコン。サイドメニューでは親メニューだけにアイコンを付ける
export const NAV_ICON_BY_GROUP: Record<string, NavIconName> = {
  "ログ集計": "cursor",
  "レポート集計": "chart",
  "データ": "upload",
};
