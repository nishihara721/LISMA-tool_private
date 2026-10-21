import * as ui from "../ui";

// レポート閲覧権限のユーザーが、許可されていないページへアクセスしようとした場合の遷移先。
export default function NoAccessPage() {
  return (
    <main style={ui.page}>
      <h1 style={ui.h1}>閲覧権限がありません</h1>
      <p style={ui.lead}>
        このページを閲覧する権限がありません。必要であれば管理者にお問い合わせください。
      </p>
    </main>
  );
}
