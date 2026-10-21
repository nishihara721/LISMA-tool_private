"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AuthCard, { AuthField, authButtonStyle, authInputStyle } from "../AuthCard";

// ID・パスワードを忘れた場合の復旧。
// 1) セットアップキーで本人(サーバーの管理者)確認 → 2) 登録済みアカウントの一覧(ログインID)を確認
// → 3) アカウントを選んで新しいパスワードを設定、の順に進める。
type AccountRow = { loginId: string; displayName: string; role: "admin" | "report_viewer" };

export default function RecoverPage() {
  const [status, setStatus] = useState<{ configured: boolean; hasAdmin: boolean } | null>(null);
  const [setupKey, setSetupKey] = useState("");
  const [accounts, setAccounts] = useState<AccountRow[] | null>(null);
  const [selected, setSelected] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneLoginId, setDoneLoginId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/setup-status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ configured: false, hasAdmin: false }));
  }, []);

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/auth/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ setupKey, ...body }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "処理に失敗しました");
    return data;
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await post({ action: "list" });
      setAccounts(data.users);
      setSelected(data.users[0]?.loginId ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "処理に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== passwordConfirm) {
      setError("パスワードが一致しません");
      return;
    }
    setBusy(true);
    try {
      await post({ action: "reset", loginId: selected, newPassword: password });
      setDoneLoginId(selected);
    } catch (e) {
      setError(e instanceof Error ? e.message : "処理に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  if (!status) return <AuthCard title="ID・パスワードを忘れた方">読み込み中…</AuthCard>;

  if (doneLoginId) {
    return (
      <AuthCard title="パスワードを再設定しました" backToLogin={false}>
        <p style={{ fontSize: 13, color: "#4b5563", lineHeight: 1.7, margin: "0 0 20px" }}>
          ログインID「{doneLoginId}」のパスワードを再設定しました。新しいパスワードでログインしてください。
        </p>
        <Link href="/login" style={{ ...authButtonStyle, display: "block", textAlign: "center", textDecoration: "none" }}>
          ログイン画面へ
        </Link>
      </AuthCard>
    );
  }

  if (!status.configured) {
    return (
      <AuthCard
        title="ID・パスワードを忘れた方"
        description="この機能を使うには、サーバーの環境変数 ADMIN_SETUP_KEY(16文字以上の、推測されにくい文字列)を設定して、サーバーを再起動(再デプロイ)してください。設定方法は docs/setup.md の「ログインできない場合・初回セットアップ」を参照してください。"
      >
        <span />
      </AuthCard>
    );
  }

  if (!status.hasAdmin) {
    return (
      <AuthCard
        title="ID・パスワードを忘れた方"
        description={
          <>
            管理者アカウントがまだ登録されていません。<Link href="/login/setup" style={{ color: "#3f8fb8" }}>初回セットアップ</Link>から最初の管理者アカウントを作成してください。
          </>
        }
      >
        <span />
      </AuthCard>
    );
  }

  if (!accounts) {
    return (
      <AuthCard
        title="ID・パスワードを忘れた方"
        description="サーバーの環境変数 ADMIN_SETUP_KEY に設定した「セットアップキー」を入力すると、登録済みのログインIDを確認し、パスワードを再設定できます。"
      >
        <form onSubmit={handleVerify}>
          <AuthField label="セットアップキー" hint="環境変数 ADMIN_SETUP_KEY の値">
            <input type="password" value={setupKey} onChange={(e) => setSetupKey(e.target.value)} style={authInputStyle} autoFocus />
          </AuthField>
          {error && <p style={{ color: "#c0392b", fontSize: 13, margin: "0 0 16px" }}>{error}</p>}
          <button type="submit" disabled={busy || !setupKey} style={authButtonStyle}>
            {busy ? "確認中..." : "確認する"}
          </button>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="パスワードの再設定"
      description="登録されているアカウントです。ログインIDを確認し、パスワードを再設定するアカウントを選んでください。"
    >
      <form onSubmit={handleReset}>
        <AuthField label="アカウント">
          <select value={selected} onChange={(e) => setSelected(e.target.value)} style={authInputStyle}>
            {accounts.map((a) => (
              <option key={a.loginId} value={a.loginId}>
                {a.loginId}({a.displayName}・{a.role === "admin" ? "管理者権限" : "レポート閲覧権限"})
              </option>
            ))}
          </select>
        </AuthField>
        <AuthField label="新しいパスワード" hint="8文字以上">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={authInputStyle} />
        </AuthField>
        <AuthField label="新しいパスワード(確認)">
          <input
            type="password"
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            style={authInputStyle}
          />
        </AuthField>
        {error && <p style={{ color: "#c0392b", fontSize: 13, margin: "0 0 16px" }}>{error}</p>}
        <button type="submit" disabled={busy || !selected} style={authButtonStyle}>
          {busy ? "再設定中..." : "パスワードを再設定"}
        </button>
      </form>
    </AuthCard>
  );
}
