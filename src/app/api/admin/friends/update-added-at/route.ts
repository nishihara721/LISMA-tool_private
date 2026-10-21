import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { recordFriendsChangedBulk } from "@/lib/daily-stats";
import { getAllSources } from "@/lib/settings-cache";
import { LSTEP_IMPORT_MAX_FRIENDS, LSTEP_IMPORT_MAX_ROWS } from "@/lib/lstep-period";

export const maxDuration = 60;

// ツール導入前から友だちだった人(流入経路リンクのクリックで自動登録されたもの。友だち一覧の「導入前」列)について、
// Lステップ側からエクスポートしたCSVの「友だち追加日時」で、追加日時を正しい値に一括更新する。
// 追加日時が確定済みの人も対象で、CSVを取り込み直せば何度でも修正できる(日ごとの集計も付け替える)。
// あわせて、CSVの「ID」をLステップナンバーとして付与し、CSVに流入経路の列(流入経路名/流入経路/登録経路)があれば、
// このツールに登録済みの流入経路名と完全一致するものについて、友だち追加時の流入経路も更新する(一致しない名前は更新しない)。
//
// 突合ルール: 表示名が完全一致し、「仮の友だち」「CSVの行」がそれぞれ1件ずつだけ該当する場合に更新する。
// 同じ表示名の友だちやCSVの行が複数ある場合は、取り違えを防ぐため更新せず「同名のため未更新」として件数に出す。
//
// 読み込むのは「追加日時が仮」の友だちだけ(全友だちは読まない)。
// body: { rows: { displayName, addedAt(ミリ秒), lstepNumber }[], check?: boolean }
//   check:true の場合は、更新はせず、仮の友だちの人数だけを返す(実行前の確認用)。
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const rows = body?.rows as { displayName: string; addedAt: number; lstepNumber: string; sourceName?: string }[] | undefined;
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "rowsは必須です" }, { status: 400 });
  }
  if (rows.length > LSTEP_IMPORT_MAX_ROWS) {
    return NextResponse.json(
      { error: `CSVの行数が多すぎます(${rows.length}行)。${LSTEP_IMPORT_MAX_ROWS}行以下になるよう、分けて取り込んでください` },
      { status: 400 }
    );
  }
  if (rows.some((r) => !r || typeof r.displayName !== "string" || typeof r.lstepNumber !== "string" || !Number.isFinite(r.addedAt))) {
    return NextResponse.json({ error: "rowsの形式が不正です" }, { status: 400 });
  }

  const base = adminDb.collection("friends").where("preExisting", "==", true);
  const preExistingCount = (await base.count().get()).data().count;
  const estimatedCount = (await base.where("addedAtEstimated", "==", true).count().get()).data().count;
  if (body?.check === true) {
    return NextResponse.json({ ok: true, preExistingCount, estimatedCount });
  }
  if (preExistingCount > LSTEP_IMPORT_MAX_FRIENDS) {
    return NextResponse.json(
      { error: `導入前の友だちが${preExistingCount.toLocaleString()}人います(上限${LSTEP_IMPORT_MAX_FRIENDS.toLocaleString()}人)` },
      { status: 400 }
    );
  }

  const snap = await base.select("displayName", "sourceId", "addedAt", "addedAtEstimated").get();
  const friends = snap.docs.map((d) => ({
    ref: d.ref,
    displayName: d.get("displayName") as string | undefined,
    sourceId: d.get("sourceId") as string | undefined,
    addedAt: d.get("addedAt") as number,
    estimated: d.get("addedAtEstimated") === true,
  }));

  const friendsByName = new Map<string, typeof friends>();
  friends.forEach((f) => {
    if (!f.displayName) return;
    const list = friendsByName.get(f.displayName) ?? [];
    list.push(f);
    friendsByName.set(f.displayName, list);
  });
  const rowsByName = new Map<string, typeof rows>();
  rows.forEach((r) => {
    const list = rowsByName.get(r.displayName) ?? [];
    list.push(r);
    rowsByName.set(r.displayName, list);
  });

  const sources = await getAllSources();
  const sourceIdByName = new Map<string, string>(sources.map((s) => [s.name, s.sourceId]));
  sourceIdByName.set("直接追加", "direct");
  let sourceUnmatched = 0; // CSVの流入経路名が、このツールの流入経路に見つからなかった件数(流入経路は変更しない)
  const updates: { ref: (typeof friends)[number]["ref"]; addedAt: number; lstepNumber: string; sourceId?: string; sourceChanged: boolean; prev: { addedAt: number; sourceId: string | undefined } | null }[] = [];
  let ambiguous = 0;
  const ambiguousNames: string[] = [];
  let noFriend = 0; // CSVにはいるが、仮の友だちに該当しない行(通常の友だち・まだ登録されていない人)
  rowsByName.forEach((nameRows, name) => {
    const candidates = friendsByName.get(name) ?? [];
    if (candidates.length === 0) {
      noFriend += nameRows.length;
      return;
    }
    if (candidates.length === 1 && nameRows.length === 1) {
      const csvSourceName = nameRows[0].sourceName?.trim();
      const newSourceId = csvSourceName ? sourceIdByName.get(csvSourceName) : undefined;
      if (csvSourceName && !newSourceId) sourceUnmatched++;
      updates.push({
        ref: candidates[0].ref,
        addedAt: nameRows[0].addedAt,
        lstepNumber: nameRows[0].lstepNumber,
        sourceId: newSourceId ?? candidates[0].sourceId,
        sourceChanged: !!newSourceId && newSourceId !== candidates[0].sourceId,
        // 日時が未確定の人は集計に入っていないので新規の追加、確定済みの人は集計の付け替え
        prev: candidates[0].estimated ? null : { addedAt: candidates[0].addedAt, sourceId: candidates[0].sourceId },
      });
      return;
    }
    ambiguous += candidates.length;
    ambiguousNames.push(name);
  });

  const chunkSize = 400;
  for (let i = 0; i < updates.length; i += chunkSize) {
    const batch = adminDb.batch();
    updates.slice(i, i + chunkSize).forEach((u) =>
      batch.set(
        u.ref,
        {
          addedAt: u.addedAt,
          lstepNumber: u.lstepNumber,
          addedAtEstimated: FieldValue.delete(),
          ...(u.sourceChanged && u.sourceId ? { sourceId: u.sourceId } : {}),
        },
        { merge: true }
      )
    );
    await batch.commit();
  }
  // 追加日時・流入経路が確定・変更されたので、日ごとの集計(レポートの友だち追加数)に反映する
  await recordFriendsChangedBulk(
    updates
      .filter((u) => !u.prev || u.prev.addedAt !== u.addedAt || u.prev.sourceId !== u.sourceId)
      .map((u) => ({ prev: u.prev, next: { addedAt: u.addedAt, sourceId: u.sourceId } }))
  );

  return NextResponse.json({
    ok: true,
    updated: updates.length,
    ambiguous, // 同名のため更新しなかった「仮の友だち」の人数
    ambiguousSample: ambiguousNames.slice(0, 10),
    noFriend,
    sourceUpdated: updates.filter((u) => u.sourceChanged).length,
    sourceUnmatched,
    remaining: Math.max(estimatedCount - updates.filter((u) => !u.prev).length, 0), // まだ日時が未確定の人数
  });
}
