import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { recordFriendsChangedBulk } from "@/lib/daily-stats";
import { getAllSources } from "@/lib/settings-cache";
import type { FriendDoc } from "@/types";

// 友だち1人の「友だち追加時の流入経路」「友だち追加日時」を手動で変更する(友だち一覧の鉛筆アイコンから)。
// body: { sourceId?: string, addedAt?: number(ミリ秒) }
//   sourceId: 流入経路管理に登録済みの流入経路のID、または "direct"(直接追加)
//   addedAt : 「導入前」の友だちのみ変更できる(通常の友だちの追加日時は友だち追加の通知で記録された正しい値のため)。
//             変更すると追加日時が確定した扱いになる。
// 日ごとの集計(レポートの友だち追加数)も付け替える。過去のクリックログの記録は変わらない。
export async function PUT(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "リクエスト内容が不正です" }, { status: 400 });
  }

  const ref = adminDb.collection("friends").doc(userId);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: "友だちが見つかりません" }, { status: 404 });
  const friend = snap.data() as FriendDoc;

  let newSourceId = friend.sourceId;
  if ("sourceId" in body) {
    if (typeof body.sourceId !== "string" || !body.sourceId) {
      return NextResponse.json({ error: "sourceIdが不正です" }, { status: 400 });
    }
    if (body.sourceId !== "direct") {
      const sources = await getAllSources();
      if (!sources.some((s) => s.sourceId === body.sourceId)) {
        return NextResponse.json({ error: "指定された流入経路が見つかりません" }, { status: 400 });
      }
    }
    newSourceId = body.sourceId;
  }

  let newAddedAt = friend.addedAt;
  const changeAddedAt = "addedAt" in body && body.addedAt !== friend.addedAt;
  if ("addedAt" in body) {
    if (typeof body.addedAt !== "number" || !Number.isFinite(body.addedAt) || body.addedAt <= 0) {
      return NextResponse.json({ error: "addedAtが不正です" }, { status: 400 });
    }
    if (changeAddedAt && !friend.preExisting) {
      return NextResponse.json({ error: "通常の友だちの友だち追加日時は変更できません(導入前の友だちのみ変更できます)" }, { status: 400 });
    }
    if (body.addedAt > Date.now() + 60 * 1000) {
      return NextResponse.json({ error: "未来の日時は指定できません" }, { status: 400 });
    }
    newAddedAt = body.addedAt;
  }

  const wasEstimated = friend.addedAtEstimated === true;
  // 日時を指定して保存した場合は、導入前の友だちの追加日時が確定した扱いにする(値が同じでも確定する)
  const confirmAddedAt = "addedAt" in body && friend.preExisting === true;
  const sourceChanged = newSourceId !== friend.sourceId;
  if (!sourceChanged && !changeAddedAt && !(confirmAddedAt && wasEstimated)) {
    return NextResponse.json({ ok: true, changed: false });
  }

  const update: Record<string, unknown> = {};
  if (sourceChanged) update.sourceId = newSourceId;
  if (changeAddedAt) update.addedAt = newAddedAt;
  if (confirmAddedAt && wasEstimated) update.addedAtEstimated = FieldValue.delete();
  await ref.set(update, { merge: true });

  // 日ごとの集計: 日時が未確定のうちは集計に入っていない(確定した時点で新規の追加として加算)、確定済みなら付け替え
  if (wasEstimated) {
    if (confirmAddedAt) {
      await recordFriendsChangedBulk([{ prev: null, next: { addedAt: newAddedAt, sourceId: newSourceId } }]);
    }
  } else if (sourceChanged || changeAddedAt) {
    await recordFriendsChangedBulk([
      { prev: { addedAt: friend.addedAt, sourceId: friend.sourceId }, next: { addedAt: newAddedAt, sourceId: newSourceId } },
    ]);
  }

  return NextResponse.json({ ok: true, changed: true });
}
