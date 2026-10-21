"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AuthCard, { AuthField, authButtonStyle, authInputStyle } from "../AuthCard";

// 初回セットアップ: 管理者アカウントが1つも無いときだけ、最初の管理者アカウントを作成する。
// 本人確認として、サーバーの環境変数 ADMIN_SETUP_KEY の値(セットアップキー)が必要。
export default function SetupPage() {
  const [status, setStatus] = useState<{ configured: boolean; hasAdmin: boolean } | null>(null);
  const [setupKey, setSetupKey] = useState("");
  const [loginId, setLoginId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch("/api/auth/setup-status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ configured: false, hasAdmin: false }));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== passwordConfirm) {
      setError("パスワードが一致しません");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupKey, loginId, displayName, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "登録に失敗しました");
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "登録に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  if (!status) return <AuthCard title="初回セットアップ">読み込み中…</AuthCard>;

  if (done) {
    return (
      <AuthCard title="登録が完了しました" backToLogin={false}>
        <p style={{ fontSize: 13, color: "#4b5563", lineHeight: 1.7, margin: "0 0 20px" }}>
          管理者アカウントを作成しました。設定したログインIDとパスワードでログインしてください。2人目以降は、ログイン後の「ユーザー管理」から作成できます。
        </p>
        <Link href="/login" style={{ ...authButtonStyle, display: "block", textAlign: "center", textDecoration: "none" }}>
          ログイン画面へ
        </Link>
      </AuthCard>
    );
  }

  if (status.hasAdmin) {
    return (
      <AuthCard
        title="初回セットアップ"
        description="管理者アカウントはすでに登録されています。ログインするか、ログインIDやパスワードを忘れた場合は、ログイン画面の「ID・パスワードを忘れた方」から復旧してください。"
      >
        <span />
      </AuthCard>
    );
  }

  if (!status.configured) {
    return (
      <AuthCard
        title="初回セットアップ"
        description="この機能を使うには、サーバーの環境変数 ADMIN_SETUP_KEY(16文字以上の、推測されにくい文字列)を設定して、サーバーを再起動(再デプロイ)してください。設定方法は docs/setup.md の「ログインできない場合・初回セットアップ」を参照してください。"
      >
        <span />
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="初回セットアップ"
      description="最初の管理者アカウントを作成します。サーバーの環境変数 ADMIN_SETUP_KEY に設定した「セットアップキー」が必要です。"
    >
      <form onSubmit={handleSubmit}>
        <AuthField label="セットアップキー" hint="環境変数 ADMIN_SETUP_KEY の値">
          <input type="password" value={setupKey} onChange={(e) => setSetupKey(e.target.value)} style={authInputStyle} autoFocus />
        </AuthField>
        <AuthField label="ログインID">
          <input value={loginId} onChange={(e) => setLoginId(e.target.value)} style={authInputStyle} />
        </AuthField>
        <AuthField label="表示名">
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} style={authInputStyle} />
        </AuthField>
        <AuthField label="パスワード" hint="8文字以上">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={authInputStyle} />
        </AuthField>
        <AuthField label="パスワード(確認)">
          <input
            type="password"
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            style={authInputStyle}
          />
        </AuthField>
        {error && <p style={{ color: "#c0392b", fontSize: 13, margin: "0 0 16px" }}>{error}</p>}
        <button type="submit" disabled={busy} style={authButtonStyle}>
          {busy ? "登録中..." : "管理者アカウントを作成"}
        </button>
      </form>
    </AuthCard>
  );
}
