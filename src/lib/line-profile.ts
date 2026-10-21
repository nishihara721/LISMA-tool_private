// LINEのプロフィール取得(Messaging API)。公式アカウントの友だち(ブロックしていない人)のみ取得できる。
// 友だちでない人・ブロック中の人は404になるため、「友だちかどうか」の判定にも使える。
export async function fetchLineProfileIfFriend(
  userId: string
): Promise<{ displayName: string; pictureUrl?: string } | null> {
  const res = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` },
  });
  if (res.status === 404) return null; // 友だちではない(未追加・ブロック中)
  if (!res.ok) throw new Error(`failed to fetch profile (${res.status})`);
  return (await res.json()) as { displayName: string; pictureUrl?: string };
}
