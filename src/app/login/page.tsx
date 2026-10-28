"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 管理者アカウントがまだ1つも無いときだけ「初めてログインする方はこちら」を表示する(登録後は非表示にする)。
  // 取得中・取得に失敗した場合も、誤って見せないよう非表示のままにする。
  const [showSetupLink, setShowSetupLink] = useState(false);

  useEffect(() => {
    fetch("/api/auth/setup-status")
      .then((r) => r.json())
      .then((s: { hasAdmin?: boolean }) => setShowSetupLink(s.hasAdmin === false))
      .catch(() => setShowSetupLink(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "ログインに失敗しました");
      const next = searchParams.get("next");
      router.push(next && next.startsWith("/admin") ? next : "/admin");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ログインに失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f7f9fb",
        padding: "24px 16px",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: 340,
          maxWidth: "100%",
          background: "#ffffff",
          border: "1px solid #e5e7eb",
          borderRadius: 10,
          padding: 32,
        }}
      >
        <h1 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 24px", color: "#111827" }}>
          管理画面ログイン
        </h1>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 6 }}>
            ログインID
          </label>
          <input
            value={loginId}
            onChange={(e) => setLoginId(e.target.value)}
            autoFocus
            style={{
              padding: "8px 10px",
              fontSize: 14,
              border: "1px solid #d1d5db",
              borderRadius: 6,
              width: "100%",
            }}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 6 }}>
            パスワード
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{
              padding: "8px 10px",
              fontSize: 14,
              border: "1px solid #d1d5db",
              borderRadius: 6,
              width: "100%",
            }}
          />
        </div>

        {error && <p style={{ color: "#c0392b", fontSize: 13, margin: "0 0 16px" }}>{error}</p>}

        <button
          type="submit"
          disabled={busy}
          style={{
            width: "100%",
            padding: "10px 16px",
            fontSize: 14,
            fontWeight: 500,
            borderRadius: 6,
            border: "1px solid #3f8fb8",
            background: "#3f8fb8",
            color: "#ffffff",
          }}
        >
          {busy ? "ログイン中..." : "ログイン"}
        </button>

        <div style={{ marginTop: 20, fontSize: 13, textAlign: "center", lineHeight: 2 }}>
          {showSetupLink && (
            <div>
              <Link href="/login/setup" style={{ color: "#3f8fb8" }}>
                初めてログインする方はこちら
              </Link>
            </div>
          )}
          <div>
            <Link href="/login/recover" style={{ color: "#3f8fb8" }}>
              ID・パスワードを忘れた方はこちら
            </Link>
          </div>
        </div>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
