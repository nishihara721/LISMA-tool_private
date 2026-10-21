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
