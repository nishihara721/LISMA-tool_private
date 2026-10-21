import { NextRequest, NextResponse } from "next/server";
import { recordFriendChanged } from "@/lib/daily-stats";
import { nanoid } from "nanoid";
import { adminDb } from "@/lib/firebase-admin";
import { verifyLineIdToken } from "@/lib/line-auth";
import { logEvent } from "@/lib/event-log";
import { fetchLineProfileIfFriend } from "@/lib/line-profile";
import { registerExistingFriend } from "@/lib/register-existing-friend";
import type { ClickDoc, FriendDoc } from "@/types";

// 購入ページ(LP)は自社サーバーとは別ドメインで運用されるため、
// track.jsからのクロスオリジン通信を許可するCORSヘッダーが必要。
// (sendBeaconでJSON形式のデータを送る場合、ブラウザは事前確認(プリフライトのOPTIONSリクエスト)を
//  行うため、これに応答できないと静かに送信が失敗する)
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}

// LIFFページ(友だち追加ページ・広告ページ)から呼び出す
// body: { linkType: "add_friend" | "purchase", sourceId?: string, purchaseLinkId?: string, idToken?: string, clickId?: string }
//
// userIdはクライアントから直接受け取らず、LIFFが発行するidTokenをLINE側で検証して取得する。
// これにより、外部ブラウザ経由でアクセスされた場合でも、他人になりすましたリクエストを防げる。
//
// clickIdはクライアント側で先に発行したものを受け取れるようにしている。
// これにより、クライアントはこのAPIの応答を待たずに(navigator.sendBeaconで投げっぱなしにして)
// 次のページへすぐ遷移でき、体感の待ち時間を短縮できる。省略された場合はサーバー側で発行する。
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { linkType, sourceId, purchaseLinkId, idToken, clickId } = body as {
    linkType: "add_friend" | "purchase";
    sourceId?: string;
    purchaseLinkId?: string;
    idToken?: string;
    clickId?: string;
  };

  if (!linkType) {
    await logEvent("warn", "track_click.missing_link_type", "linkTypeが指定されずにクリックAPIが呼ばれました", {
      sourceId,
      purchaseLinkId,
    });
    return NextResponse.json({ error: "linkType is required" }, { status: 400, headers: CORS_HEADERS });
  }

  let userId: string | undefined;
  if (idToken) {
    try {
      const verified = await verifyLineIdToken(idToken);
      userId = verified.userId;
    } catch (e) {
      // 検証に失敗した場合はuserIdなしのクリックとして記録する(なりすましは防げるが、計測は残す)
      await logEvent("warn", "track_click.id_token_verify_failed", "IDトークンの検証に失敗しました", {
        linkType,
        sourceId,
        purchaseLinkId,
        error: String(e),
      });
    }
  } else if (linkType === "add_friend") {
    // 友だち追加リンクはユーザー識別が前提のため、idToken自体が届かなかった場合は
    // 外部ブラウザで開かれた・LIFF側で失敗した等の可能性があり、追跡しておく価値がある
    await logEvent("info", "track_click.no_id_token", "IDトークンなしで友だち追加リンクのクリックを記録しました(外部ブラウザ等の可能性)", {
      sourceId,
      clickId,
    });
  }

  const click: ClickDoc = {
    clickId: clickId ?? nanoid(10),
    linkType,
    sourceId: sourceId ?? "unknown",
    purchaseLinkId,
    userId,
    clickedAt: Date.now(),
    userAgent: req.headers.get("user-agent") ?? undefined,
  };

  // クリックログの「友だち追加時の流入経路」「最新の流入経路」は、後から友だちドキュメントの値が
  // 変わっても表示が変化しないよう、このクリック時点の値をスナップショットとして複製しておく。
  if (linkType === "add_friend" && sourceId) {
    const sourceSnap = await adminDb.collection("sources").doc(sourceId).get();
    if (sourceSnap.exists) click.sourceNameAtClick = (sourceSnap.data() as { name?: string }).name;
  }

  if (linkType === "add_friend" && !userId) click.statusAtClick = "unidentified";

  if (userId) {
    if (linkType === "add_friend") {
      // このクリック自体が友だちの「最新の流入経路」を更新するので、更新後の値を複製する
      const updated = await updateFriendSourceInfo(userId, sourceId ?? "unknown", click.clickId);
      click.friendSourceIdAtClick = updated.sourceId;
      click.friendLatestSourceIdAtClick = updated.latestSourceId;
      click.statusAtClick = updated.status;
    } else {
      // 広告のクリックはこの値を変更しないため、クリック時点の値をそのまま複製するだけでよい
      const snap = await adminDb.collection("friends").doc(userId).get();
      if (snap.exists) {
        const friend = snap.data() as FriendDoc;
        click.friendSourceIdAtClick = friend.sourceId;
        click.friendLatestSourceIdAtClick = friend.latestSourceId ?? friend.sourceId;
      }
    }
  }

  await adminDb.collection("clicks").doc(click.clickId).set(click);

  return NextResponse.json({ ok: true, clickId: click.clickId }, { headers: CORS_HEADERS });
}

// 友だちの「最新の流入経路」を更新し、更新後の(このクリック時点で確定した)sourceId・latestSourceIdを返す。
// クリックログ側でのスナップショット保存に使うため、更新結果をそのまま呼び出し元に返している。
async function updateFriendSourceInfo(
  userId: string,
  sourceId: string,
  clickId: string
): Promise<{ sourceId: string; latestSourceId: string; status: NonNullable<ClickDoc["statusAtClick"]> }> {
  const ref = adminDb.collection("friends").doc(userId);
  const snap = await ref.get();
  if (!snap.exists) {
    // まだfollowイベントが届いていない(=このクリックが初回の友だち追加リンクのクリック)場合、友だちドキュメントは
    // 更新できない(後からfollowイベントがこのクリックを紐づけて作成する)が、そのときの「追加時の流入経路」は
    // このクリックの流入経路になる。クリックログの表示が後から変わらないよう、その値をスナップショットとして返す。
    //
    // ただし、ツール導入前から友だちだった人も、友だちドキュメントが無いのは同じ。LINEのプロフィール取得は友だち
    // (ブロックしていない人)にしか成功しないため、取得できた場合は「導入前からの友だち」として自動登録する。
    // 追加日時は分からないため、このクリックの日時で代用する(addedAtEstimated。LステップのCSVで後から更新できる)。
    try {
      const profile = await fetchLineProfileIfFriend(userId);
      if (profile) {
        const created = await registerExistingFriend({
          userId,
          displayName: profile.displayName,
          pictureUrl: profile.pictureUrl,
          sourceId,
          clickId,
          clickedAt: Date.now(),
        });
        if (created) return { sourceId, latestSourceId: sourceId, status: "registered" };
      }
    } catch (e) {
      // 判定・登録に失敗しても、クリックの記録自体は続ける(次回のクリックで再度試みる)
      await logEvent("warn", "track_click.register_existing_friend_failed", "導入前の友だちの自動登録に失敗しました", {
        userId,
        error: String(e),
      });
    }
    return { sourceId, latestSourceId: sourceId, status: "not_added" };
  }

  const friend = snap.data() as FriendDoc;
  const updates: Partial<FriendDoc> = {
    // 「最新の流入経路」は、追加後に流入経路リンクを再クリックするたびに常に更新する
    latestSourceId: sourceId,
    latestSourceClickId: clickId,
  };

  // 「友だち追加時の流入経路」(sourceId)自体は、一度確定したら基本的に上書きしない(ファーストタッチを保持するため)。
  // ただし、「followイベントが、このクリック記録より先に届いていた」ケースに備えて、
  // まだ"direct"(流入経路不明)のままになっている場合だけは、このクリックの情報で補完する。
  // (Webhook側にもクリックを待ってから紐づけるリトライ処理を入れているが、
  //  それでも間に合わなかった場合の最後の保険としてここでも上書きする)
  const resultingSourceId = friend.sourceId === "direct" ? sourceId : friend.sourceId;
  if (friend.sourceId === "direct") {
    updates.sourceId = sourceId;
    updates.sourceClickId = clickId;
  }

  await ref.set(updates, { merge: true });
  // 友だち追加時の流入経路が補完された場合は、日ごとの集計(daily_stats)の流入経路も付け替える
  if (friend.sourceId === "direct" && sourceId !== "direct") {
    await recordFriendChanged({ addedAt: friend.addedAt, sourceId: "direct" }, { addedAt: friend.addedAt, sourceId });
  }

  // ブロック(またはブロック解除前の友だち削除)状態のユーザーがリンクを押した場合は「ブロック解除」、それ以外は再クリック
  return {
    sourceId: resultingSourceId,
    latestSourceId: sourceId,
    status: friend.unfollowedAt ? "unblocked" : "existing",
  };
}
