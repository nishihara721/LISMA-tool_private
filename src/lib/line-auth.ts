// LIFFのクライアント側から送られてきたIDトークンをLINEプラットフォームに問い合わせて検証する。
// クライアントから直接 userId を送らせず、この検証済みの sub(=userId)だけを信用することで、
// 外部ブラウザ経由でも「他人になりすました成果記録」を防ぐ。
export async function verifyLineIdToken(idToken: string): Promise<{ userId: string }> {
  const channelId = process.env.LINE_CHANNEL_ID;
  if (!channelId) {
    throw new Error("LINE_CHANNEL_ID が未設定です");
  }

  const res = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`IDトークンの検証に失敗しました: ${res.status} ${errBody}`);
  }

  const data = (await res.json()) as { sub: string; aud: string };
  return { userId: data.sub };
}
