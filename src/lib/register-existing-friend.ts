import { adminDb } from "./firebase-admin";
import type { FriendDoc } from "@/types";

// ツール導入前から友だちだった人が、初めて流入経路リンクを踏んだときに、友だちとして自動登録する。
// 追加日時は分からないため、リンクを踏んだ日時で代用し、addedAtEstimated: true を付ける
// (LステップのCSVで追加日時を更新すると外れる。日ごとの集計・レポートには、確定するまで含めない)。
// すでに友だちドキュメントがある場合は何もしない(false)。IDは通常の友だち追加と同じ連番で採番する。
export async function registerExistingFriend(params: {
  userId: string;
  displayName?: string;
  pictureUrl?: string;
  sourceId: string;
  clickId: string;
  clickedAt: number;
}): Promise<boolean> {
  const friendRef = adminDb.collection("friends").doc(params.userId);
  const counterRef = adminDb.collection("counters").doc("friendIdNumber");
  let created = false;
  await adminDb.runTransaction(async (tx) => {
    created = false;
    const friendSnap = await tx.get(friendRef);
    if (friendSnap.exists) return;
    const counterSnap = await tx.get(counterRef);
    const nextIdNumber = ((counterSnap.data()?.value as number | undefined) ?? 0) + 1;
    const friend: FriendDoc = {
      userId: params.userId,
      displayName: params.displayName,
      pictureUrl: params.pictureUrl,
      sourceId: params.sourceId,
      sourceClickId: params.clickId,
      latestSourceId: params.sourceId,
      latestSourceClickId: params.clickId,
      addedAt: params.clickedAt,
      preExisting: true,
      addedAtEstimated: true,
      unfollowedAt: null,
      idNumber: nextIdNumber,
    };
    // undefinedの項目はFirestoreに書けないため取り除く
    const data = Object.fromEntries(Object.entries(friend).filter(([, v]) => v !== undefined));
    tx.set(counterRef, { value: nextIdNumber }, { merge: true });
    tx.set(friendRef, data);
    created = true;
  });
  return created;
}
