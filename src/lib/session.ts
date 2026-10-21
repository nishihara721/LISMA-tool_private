// 管理画面ログインのセッションCookie(署名付きトークン)を発行・検証する。
//
// Next.jsのMiddleware(Edge Runtime)とAPI Route(Node Runtime)の両方で検証する必要があるため、
// Node.js専用のcrypto.createHmac等ではなく、両方の環境で使えるWeb Crypto API(crypto.subtle)を使う。
export const ADMIN_SESSION_COOKIE = "admin_session";

// 役割: 管理者権限(全ページ閲覧・編集可) / レポート閲覧権限(allowedPagesで閲覧可能なページを個別指定)
export type AdminRole = "admin" | "report_viewer";

export type SessionPayload = {
  userId: string;
  loginId: string;
  displayName: string;
  role: AdminRole;
  // role が report_viewer の場合のみ使用。閲覧可能なページのpath一覧(admin-pages.tsのADMIN_PAGESのpath)。
  allowedPages: string[] | null;
  iat: number; // 発行日時(epoch ms)
  exp: number; // 有効期限(epoch ms)
};

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30日間

function getSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) {
    throw new Error("管理画面ログインの環境変数(ADMIN_SESSION_SECRET)が未設定です");
  }
  return secret;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function getHmacKey(): Promise<CryptoKey> {
  const secret = getSecret();
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

// 新規ログイン時にセッショントークンを発行する。
export async function createSessionToken(
  user: Pick<SessionPayload, "userId" | "loginId" | "displayName" | "role" | "allowedPages">
): Promise<string> {
  const now = Date.now();
  const payload: SessionPayload = {
    ...user,
    iat: now,
    exp: now + SESSION_DURATION_MS,
  };
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const payloadB64 = toBase64Url(payloadBytes);
  const key = await getHmacKey();
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  const signatureB64 = toBase64Url(new Uint8Array(signature));
  return `${payloadB64}.${signatureB64}`;
}

// Cookieから受け取ったトークンを検証し、問題なければペイロードを返す。
// 署名が合わない・期限切れ・形式不正等の場合はnullを返す(呼び出し側はログイン画面に戻す)。
export async function verifySessionToken(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, signatureB64] = parts;

  try {
    const key = await getHmacKey();
    const signatureBytes = fromBase64Url(signatureB64);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      new TextEncoder().encode(payloadB64)
    );
    if (!valid) return null;

    const payloadJson = new TextDecoder().decode(fromBase64Url(payloadB64));
    const payload = JSON.parse(payloadJson) as SessionPayload;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// 指定したページ(path)を、このセッションのユーザーが閲覧できるかどうか。
export function canAccessPage(session: SessionPayload, path: string): boolean {
  if (session.role === "admin") return true;
  if (!session.allowedPages) return false;
  return session.allowedPages.includes(path);
}
