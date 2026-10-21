import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";

// ログイン・初回セットアップ・ID/パスワード復旧の3画面で共通のカード表示と入力欄のスタイル。
export const authInputStyle: CSSProperties = {
  padding: "8px 10px",
  fontSize: 14,
  border: "1px solid #d1d5db",
  borderRadius: 6,
  width: "100%",
};

export const authButtonStyle: CSSProperties = {
  width: "100%",
  padding: "10px 16px",
  fontSize: 14,
  fontWeight: 500,
  borderRadius: 6,
  border: "1px solid #3f8fb8",
  background: "#3f8fb8",
  color: "#ffffff",
};

export function AuthField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 6 }}>
        {label}
      </label>
      {children}
      {hint && <p style={{ fontSize: 12, color: "#6b7280", margin: "6px 0 0" }}>{hint}</p>}
    </div>
  );
}

export default function AuthCard({
  title,
  description,
  children,
  backToLogin = true,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  backToLogin?: boolean;
}) {
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
      <div
        style={{
          width: 380,
          maxWidth: "100%",
          background: "#ffffff",
          border: "1px solid #e5e7eb",
          borderRadius: 10,
          padding: 32,
        }}
      >
        <h1 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 12px", color: "#111827" }}>{title}</h1>
        {description && <p style={{ fontSize: 13, color: "#4b5563", lineHeight: 1.7, margin: "0 0 20px" }}>{description}</p>}
        {children}
        {backToLogin && (
          <p style={{ fontSize: 13, margin: "20px 0 0", textAlign: "center" }}>
            <Link href="/login" style={{ color: "#3f8fb8" }}>
              ログイン画面に戻る
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
