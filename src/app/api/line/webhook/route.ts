import { NextRequest, NextResponse } from "next/server";
import { recordFriendAdded, recordFriendChanged } from "@/lib/daily-stats";
import { validateSignature, WebhookEvent } from "@line/bot-sdk";
import { adminDb } from "@/lib/firebase-admin";
import { logEvent } from "@/lib/event-log";
import { FieldValue } from "firebase-admin/firestore";
import type { FriendDoc } from "@/types";

const channelSecret = process.env.LINE_CHANNEL_SECRET!;
const lstepWebhookUrl = process.env.LSTEP_WEBHOOK_URL; // 例: https://rcv.linestep.net/v3/call/xxxxxxxxxx

// LINE Developersコンソールの Webhook URL にこのエンドポイントを設定する
// 例: https://your-app.example.com/api/line/webhook
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-line-signature") ?? "";

  if (!validateSignature(rawBody, channelSecret, signature)) {
    // 署名検証失敗は「LINE以外からの不正なリクエスト」または「チャネルシークレットの設定ミス」を
    // 示している可能性があるため記録しておく
    await logEvent("error", "line_webhook.invalid_signature", "Webhookの署名検証に失敗しました", {
      hasSignatureHeader: !!signature,
    });
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const body = JSON.parse(rawBody) as { events: WebhookEvent[] };

  // このツールでの処理と、Lステップへの転送は互いに独立して行う
  // (Lステップ側の処理が失敗・遅延しても、このツール側の記録には影響させない)
  await Promise.all([
    Promise.all(body.events.map(handleEvent)),
    forwardToLstep(rawBody, signature),
  ]);

  return NextResponse.json({ ok: true });
}

// 1つのMessaging APIチャネルにはWebhook URLを1つしか登録できないため、
// このツールで受け取ったWebhookを、受け取った内容そのまま(未加工)でLステップにも転送する。
// 元のボディ・署名をそのまま横流しするので、Lステップ側の署名検証もそのまま通る。
async function forwardToLstep(rawBody: string, signature: string) {
  if (!lstepWebhookUrl) return; // 未設定の場合は転送しない

  try {
    await fetch(lstepWebhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-line-signature": signature,
      },
      body: rawBody,
    });
  } catch (e) {
    // Lステップへの転送に失敗しても、このツール側の処理は継続する
    await logEvent("error", "line_webhook.lstep_forward_failed", "LステップへのWebhook転送に失敗しました", {
      error: String(e),
    });
  }
}

async function handleEvent(event: WebhookEvent) {
  if (event.type === "follow") {
    await handleFollow(event.source.userId!);
    return;
  }
  if (event.type === "unfollow") {
    await handleUnfollow(event.source.userId!);
    return;
  }
  // 他のイベント(message, postback等)は今後ここに追加していく
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 直前にLIFFの友だち追加リンクを踏んだ際のclickログを検索する。
// クリック記録(/api/track/click)の書き込みより先にLINEから follow イベントが届くことがあり、
// その場合すぐに検索すると見つからず「direct」扱いになってしまう。
// そのため見つからない場合は少し待ってから数回リトライする。
async function findPendingClick(userId: string) {
  const delaysMs = [0, 600, 1200, 2000];
  for (const delay of delaysMs) {
    if (delay > 0) await sleep(delay);

    const snap = await adminDb
      .collection("clicks")
      .where("linkType", "==", "add_friend")
      .where("userId", "==", userId)
      .orderBy("clickedAt", "desc")
      .limit(1)
      .get();

    if (!snap.empty) return snap.docs[0].data();
  }
  return undefined;
}

async function handleFollow(userId: string) {
  const pendingClick = await findPendingClick(userId);

  if (!pendingClick) {
    // 流入経路リンクのクリック記録が見当たらないまま「直接追加」として扱うケース。
    // 本当に直接追加された場合は正常だが、クリック記録の書き込み遅延・失敗で
    // 見つからなかった可能性もあるため、原因追跡用に記録しておく
    await logEvent(
      "warn",
      "line_webhook.pending_click_not_found",
      "流入経路リンクのクリック記録が見つからず、直接追加として記録しました",
      { userId }
    );
  }

  const initialSourceId = pendingClick?.sourceId ?? "direct";
  const friend: FriendDoc = {
    userId,
    sourceId: initialSourceId,
    sourceClickId: pendingClick?.clickId,
    // 追加時点では「最新の流入経路」も追加時の流入経路と同じ値にしておく。
    // (その後、同じ人が流入経路リンクを再クリックした場合のみ更新される)
    latestSourceId: initialSourceId,
    latestSourceClickId: pendingClick?.clickId,
    addedAt: Date.now(),
    unfollowedAt: null,
  };

  // 表示名・アイコンはMessaging APIのプロフィール取得で補完(任意)
  try {
    const profile = await fetchLineProfile(userId);
    friend.displayName = profile.displayName;
    friend.pictureUrl = profile.pictureUrl;
  } catch (e) {
    // プロフィール取得に失敗しても友だち登録自体は継続する
    await logEvent("warn", "line_webhook.fetch_profile_failed", "友だちのプロフィール取得に失敗しました", {
      userId,
      error: String(e),
    });
  }

  // ID(友だち追加日時が古い順の連番)を、counters/friendIdNumber の値をインクリメントして
  // トランザクション内で採番する(既存の友だちへの一括付与は /api/admin/friends/assign-id-numbers で行う)。
  // 一度ブロック→再度追加した場合に番号が振り直されないよう、既にidNumberを持つ場合は採番しない。
  const friendRef = adminDb.collection("friends").doc(userId);
  const counterRef = adminDb.collection("counters").doc("friendIdNumber");
  // 日ごとの集計(daily_stats)を更新するため、すでに友だちドキュメントがあった場合(ブロック後の再追加)の追加日時・流入経路を控える
  let prev: { addedAt: number; sourceId: string | undefined; estimated?: boolean } | undefined;
  // ブロック解除による再追加(すでに確定した追加日時・流入経路を持つ友だち)かどうか
  let isReFollow = false;
  await adminDb.runTransaction(async (tx) => {
    prev = undefined;
    isReFollow = false;
    const friendSnap = await tx.get(friendRef);
    if (friendSnap.exists && typeof friendSnap.data()?.addedAt === "number") {
      prev = {
        addedAt: friendSnap.data()!.addedAt as number,
        sourceId: friendSnap.data()!.sourceId as string | undefined,
        estimated: friendSnap.data()!.addedAtEstimated === true,
      };
    }
    const existingIdNumber = friendSnap.data()?.idNumber as number | undefined;
    if (existingIdNumber && friendSnap.data()?.addedAtEstimated !== true) {
      // ブロック → ブロック解除(再追加)。友だち一覧の「友だち追加日時」「流入経路」は初回の友だち追加時の値のまま残す。
      // (直前のクリック記録は、再クリックのものである可能性があり、初回の流入経路とは限らないため、上書きしない)
      // 「最新の流入経路」も、リンクのクリック時(/api/track/click)に更新済みのため、ここでは触らない。
      isReFollow = true;
      tx.set(
        friendRef,
        {
          unfollowedAt: null,
          ...(friend.displayName ? { displayName: friend.displayName } : {}),
          ...(friend.pictureUrl ? { pictureUrl: friend.pictureUrl } : {}),
        },
        { merge: true }
      );
      return;
    }
    if (existingIdNumber) {
      // 追加日時が仮だった友だち(導入前からの友だちを自動登録したもの)は、今回の追加で日時が確定するため仮の印を外す
      // ただし、自動登録からほとんど時間が経っていない場合は、「友だち追加の直後に、遅れて届いたリンクのクリック記録」で
      // 自動登録されてしまっただけ(導入前からの友だちではない)ため、「導入前」の印も外す。
      const registeredAt = friendSnap.data()?.addedAt as number | undefined;
      const justRegistered =
        friendSnap.data()?.addedAtEstimated === true && registeredAt !== undefined && friend.addedAt - registeredAt < 2 * 60 * 1000;
      tx.set(
        friendRef,
        { ...friend, addedAtEstimated: FieldValue.delete(), ...(justRegistered ? { preExisting: FieldValue.delete() } : {}) },
        { merge: true }
      );
      return;
    }
    const counterSnap = await tx.get(counterRef);
    const nextIdNumber = ((counterSnap.data()?.value as number | undefined) ?? 0) + 1;
    tx.set(counterRef, { value: nextIdNumber }, { merge: true });
    tx.set(friendRef, { ...friend, idNumber: nextIdNumber }, { merge: true });
  });

  // ブロック解除による再追加は、友だち追加数(日ごとの集計)に加えない(初回の追加日のまま)
  if (isReFollow) return;

  const before = prev as { addedAt: number; sourceId: string | undefined; estimated?: boolean } | undefined;
  // 仮の日時だった友だちは集計に含めていなかったため、付け替えではなく新規の追加として数える
  if (before && !before.estimated) await recordFriendChanged(before, { addedAt: friend.addedAt, sourceId: friend.sourceId });
  else await recordFriendAdded(friend.addedAt, friend.sourceId);
}

async function handleUnfollow(userId: string) {
  await adminDb
    .collection("friends")
    .doc(userId)
    .set({ unfollowedAt: Date.now() }, { merge: true });
}

async function fetchLineProfile(userId: string) {
  const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
    headers: {
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
  });
  if (!res.ok) throw new Error("failed to fetch profile");
  return res.json() as Promise<{ displayName: string; pictureUrl?: string }>;
}
