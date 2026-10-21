import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { getDocsByIds } from "@/lib/firestore-utils";
import { getEffectiveCvEntries } from "@/lib/report-cv";
import type { FriendDoc, PurchaseLinkDoc, SourceDoc } from "@/types";

// 編集用成果ログ画面用: 指定した日付範囲(日本時間)の実効成果一覧(自動計測+手動追加、非表示分も含む)を返す。
// 画面側で表示名にできるよう、流入経路名・広告名・友だち表示名を解決してから返す。
//
// クエリ: /api/report/cv-log?from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  if (!from || !to) {
    return NextResponse.json({ error: "from・toは必須です(YYYY-MM-DD)" }, { status: 400 });
  }

  const fromMs = new Date(`${from}T00:00:00+09:00`).getTime();
  const toMs = new Date(`${to}T23:59:59.999+09:00`).getTime();
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || fromMs > toMs) {
    return NextResponse.json({ error: "日付の指定が不正です" }, { status: 400 });
  }

  const entries = await getEffectiveCvEntries(fromMs, toMs);

  // 表示対象(この画面に登場する)IDだけをまとめて取得し、コレクション全体を読まないようにする
  const userIds = entries.map((e) => e.userId).filter((id): id is string => !!id);
  const sourceIds = entries.map((e) => e.sourceId).filter((id): id is string => !!id);
  const purchaseLinkIds = entries.map((e) => e.purchaseLinkId).filter((id): id is string => !!id);

  const [friendMap, sourceMap, purchaseLinkMap] = await Promise.all([
    getDocsByIds<FriendDoc>(adminDb.collection("friends"), userIds),
    getDocsByIds<SourceDoc>(adminDb.collection("sources"), sourceIds),
    getDocsByIds<PurchaseLinkDoc>(adminDb.collection("purchase_links"), purchaseLinkIds),
  ]);

  const rows = entries.map((e) => {
    const friendName = e.userId ? friendMap.get(e.userId)?.displayName ?? e.userId : undefined;
    const sourceName =
      e.kind === "auto"
        ? e.sourceId === "direct"
          ? "直接追加"
          : e.sourceId
          ? sourceMap.get(e.sourceId)?.name ?? e.sourceId
          : undefined
        : e.sourceName;
    const purchaseLinkName =
      e.kind === "auto"
        ? e.purchaseLinkId
          ? purchaseLinkMap.get(e.purchaseLinkId)?.name ?? e.purchaseLinkId
          : undefined
        : e.purchaseLinkName;

    return {
      id: e.id,
      kind: e.kind,
      hidden: e.hidden,
      convertedAt: e.convertedAt,
      friendName,
      sourceName,
      purchaseLinkName,
      note: e.note,
    };
  });

  return NextResponse.json({ rows });
}
