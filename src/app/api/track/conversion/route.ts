import { NextRequest, NextResponse } from "next/server";
import { applyStatsDeltas, cvDelta } from "@/lib/daily-stats";
import { nanoid } from "nanoid";
import { adminDb } from "@/lib/firebase-admin";
import { logEvent } from "@/lib/event-log";
import type { ClickDoc, FriendDoc } from "@/types";

// 購入完了後のサンクスページ(自社の通常のページでよい。LIFFである必要はない)から呼び出す。
//
// clickIdは、広告クリック時点ですでにIDトークンで検証済みのuserIdと紐づいて
// clicksコレクションに保存されているため、ここで改めて本人確認をする必要はない。
// Google広告のgclidやMetaのfbclidと同じ考え方で、推測困難なclickId自体が
// 「このクリックの持ち主(クリックした人)」を示す鍵になる。
//
// 呼び出し方は2通り:
// 1. GET  /api/track/conversion?clickId=xxx  → 1x1の透明画像を返す(サンクスページに<img>タグで埋め込む)
// 2. POST /api/track/conversion  body: { clickId } → JSONを返す(自社サーバー・決済Webhookなどから呼ぶ)
async function recordConversion(clickId: string | null, calledFrom: string) {
  if (!clickId) {
    await logEvent("warn", "track_conversion.missing_click_id", "clickIdなしで成果計測が呼ばれました", { calledFrom });
    return { error: "clickIdは必須です" as const, status: 400 as const };
  }

  const clickSnap = await adminDb.collection("clicks").doc(clickId).get();
  const click = clickSnap.data() as ClickDoc | undefined;
  if (!click || click.linkType !== "purchase" || !click.purchaseLinkId) {
    // clickIdに対応するクリック記録が見当たらない(サンクスページのclickId引き継ぎ漏れ、
    // 別ドメインを挟んでいる、リンクの不備等の可能性がある)
    await logEvent(
      "warn",
      "track_conversion.click_not_found",
      "clickIdに対応する広告のクリックが見つかりませんでした",
      { clickId, calledFrom, foundLinkType: click?.linkType }
    );
    return { error: "clickIdに対応する広告のクリックが見つかりません" as const, status: 404 as const };
  }

  // 同じclickIdからの二重計測(サンクスページの再読み込み等)を防ぐ
  const existing = await adminDb.collection("conversions").where("clickId", "==", clickId).limit(1).get();
  if (!existing.empty) {
    return { ok: true as const, conversionId: existing.docs[0].id, deduped: true };
  }

  // userIdは、LP到達時点でtrack.jsが裏側でLIFFのログイン状態から取得できていれば
  // 既にこのclickドキュメントに入っている。それでも未特定の場合は、
  // 成果自体はカウントしつつ流入経路は"unknown"として記録する。
  const friendSnap = click.userId ? await adminDb.collection("friends").doc(click.userId).get() : undefined;
  const friendData = friendSnap?.data() as FriendDoc | undefined;
  const friendSourceId = friendData?.sourceId ?? "unknown"; // 友だち追加時(ファーストタッチ)の流入経路
  const friendLatestSourceId = friendData?.latestSourceId ?? friendSourceId; // 成果時点での最新の流入経路

  const conversionId = nanoid(10);
  const convertedAt = Date.now();
  await adminDb.collection("conversions").doc(conversionId).set({
    conversionId,
    userId: click.userId,
    sourceId: friendSourceId,
    latestSourceId: friendLatestSourceId,
    purchaseLinkId: click.purchaseLinkId,
    clickId,
    convertedAt,
  });
  // 日ごとの集計(daily_stats)に加算する(レポートはこの集計を読む)
  await applyStatsDeltas([
    cvDelta(convertedAt, { sourceId: friendSourceId, latestSourceId: friendLatestSourceId, purchaseLinkId: click.purchaseLinkId }, 1),
  ]);

  return { ok: true as const, conversionId };
}

// 1x1の透明GIF(base64)。画像タグでの計測時にブラウザへ返す。
const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7",
  "base64"
);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  const clickId = req.nextUrl.searchParams.get("clickId");
  await recordConversion(clickId, "GET(画像タグ)"); // 画像タグからの呼び出しなのでエラーでも画像自体は返す

  return new NextResponse(TRANSPARENT_GIF, {
    headers: { "Content-Type": "image/gif", "Cache-Control": "no-store", ...CORS_HEADERS },
  });
}

export async function POST(req: NextRequest) {
  const { clickId } = (await req.json()) as { clickId?: string };
  const result = await recordConversion(clickId ?? null, "POST(track.js)");

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status, headers: CORS_HEADERS });
  }
  return NextResponse.json(result, { headers: CORS_HEADERS });
}
