import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { recordFriendsChangedBulk } from "@/lib/daily-stats";
import { getAllSources } from "@/lib/settings-cache";
import type { FriendImportRow } from "@/lib/lstep-import";

export const maxDuration = 60;

const MAX_ROWS = 20000;

// 友だちの情報を、CSVで一括更新する。
// 列: ID(このツールの友だち一覧の「ID」)・表示名・友だち追加日時・流入経路名・Lステップナンバー。
// IDで友だちを1対1に特定し、ファイルに値がある項目だけを更新する(空欄は変更しない)。
//   - 友だち追加日時: 「導入前」の友だちのみ(通常の友だちは友だち追加の通知で正しい日時が入っているため変更しない)。
//                     確定すると「追加日時が仮」の状態が解除される。何度でも修正できる。未来の日時は更新しない
//   - 流入経路名: このツールに登録済みの流入経路名、または「直接追加」と完全一致する場合のみ
//   - Lステップナンバー: すべての友だちが対象
//   - 表示名: 更新はしない。ID違いに気づけるよう、名前が食い違う件数を知らせるためだけに使う
// 日ごとの集計(レポートの友だち追加数)も付け替える。
// body: { rows: FriendImportRow[], check?: boolean }  check:true の場合は更新せず、突合の結果だけを返す(実行前の確認用)。
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const rows = body?.rows as FriendImportRow[] | undefined;
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "rowsは必須です" }, { status: 400 });
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `行数が多すぎます(${rows.length.toLocaleString()}行)。${MAX_ROWS.toLocaleString()}行以下になるよう、分けて取り込んでください` },
      { status: 400 }
    );
  }
  if (
    rows.some(
      (r) =>
        !r ||
        !Number.isInteger(r.idNumber) ||
        r.idNumber <= 0 ||
        (r.addedAt !== undefined && !Number.isFinite(r.addedAt)) ||
        (r.displayName !== undefined && typeof r.displayName !== "string") ||
        (r.sourceName !== undefined && typeof r.sourceName !== "string") ||
        (r.lstepNumber !== undefined && typeof r.lstepNumber !== "string")
    )
  ) {
    return NextResponse.json({ error: "rowsの形式が不正です" }, { status: 400 });
  }

  // ---- IDで友だちを探す(in クエリを30件ずつ。該当した友だちの分だけ読み込む) ----
  type Friend = {
    ref: FirebaseFirestore.DocumentReference;
    displayName: string | undefined;
    sourceId: string | undefined;
    addedAt: number;
    estimated: boolean;
    preExisting: boolean;
    lstepNumber: string | undefined;
  };
  const friendsById = new Map<number, Friend[]>();
  const ids = Array.from(new Set(rows.map((r) => r.idNumber)));
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
  const PARALLEL = 10;
  for (let i = 0; i < chunks.length; i += PARALLEL) {
    const snaps = await Promise.all(
      chunks
        .slice(i, i + PARALLEL)
        .map((c) =>
          adminDb
            .collection("friends")
            .where("idNumber", "in", c)
            .select("idNumber", "displayName", "sourceId", "addedAt", "addedAtEstimated", "preExisting", "lstepNumber")
            .get()
        )
    );
    snaps.forEach((snap) =>
      snap.docs.forEach((d) => {
        const id = d.get("idNumber") as number;
        const list = friendsById.get(id) ?? [];
        list.push({
          ref: d.ref,
          displayName: d.get("displayName") as string | undefined,
          sourceId: d.get("sourceId") as string | undefined,
          addedAt: d.get("addedAt") as number,
          estimated: d.get("addedAtEstimated") === true,
          preExisting: d.get("preExisting") === true,
          lstepNumber: d.get("lstepNumber") as string | undefined,
        });
        friendsById.set(id, list);
      })
    );
  }

  const sources = await getAllSources();
  const sourceIdByName = new Map<string, string>(sources.map((s) => [s.name, s.sourceId]));
  sourceIdByName.set("直接追加", "direct");

  const now = Date.now();
  let notFound = 0;
  const notFoundSample: number[] = [];
  let duplicateId = 0; // 同じIDの友だちが複数いて特定できず、更新しなかった件数
  let nameMismatch = 0;
  const nameMismatchSample: string[] = [];
  let addedAtSkippedNormal = 0; // 通常の友だちのため、追加日時を更新しなかった件数
  let addedAtSkippedFuture = 0; // 未来の日時のため更新しなかった件数
  let sourceUnmatched = 0; // 流入経路名が登録されていないため更新しなかった件数
  const sourceUnmatchedSample: string[] = [];
  const updates: {
    ref: Friend["ref"];
    set: Record<string, unknown>;
    addedAtChanged: boolean;
    sourceChanged: boolean;
    lstepChanged: boolean;
    stats: { prev: { addedAt: number; sourceId: string | undefined } | null; next: { addedAt: number; sourceId: string | undefined } } | null;
  }[] = [];

  rows.forEach((r) => {
    const found = friendsById.get(r.idNumber);
    if (!found || found.length === 0) {
      notFound++;
      if (notFoundSample.length < 10) notFoundSample.push(r.idNumber);
      return;
    }
    if (found.length > 1) {
      duplicateId++;
      return;
    }
    const f = found[0];
    if (r.displayName && f.displayName && r.displayName !== f.displayName) {
      nameMismatch++;
      if (nameMismatchSample.length < 5) nameMismatchSample.push(`ID ${r.idNumber}(${f.displayName} ⇔ ${r.displayName})`);
    }

    const set: Record<string, unknown> = {};
    let newAddedAt = f.addedAt;
    let newSourceId = f.sourceId;
    let addedAtChanged = false;
    let sourceChanged = false;
    let lstepChanged = false;

    if (r.addedAt !== undefined) {
      if (!f.preExisting) addedAtSkippedNormal++;
      else if (r.addedAt > now) addedAtSkippedFuture++;
      else {
        // 日時が同じでも、「仮」の状態は確定として解除する
        if (r.addedAt !== f.addedAt) {
          set.addedAt = r.addedAt;
          newAddedAt = r.addedAt;
          addedAtChanged = true;
        }
        if (f.estimated) {
          set.addedAtEstimated = FieldValue.delete();
          addedAtChanged = true;
        }
      }
    }
    if (r.sourceName !== undefined) {
      const sid = sourceIdByName.get(r.sourceName);
      if (!sid) {
        sourceUnmatched++;
        if (sourceUnmatchedSample.length < 5 && !sourceUnmatchedSample.includes(r.sourceName)) sourceUnmatchedSample.push(r.sourceName);
      } else if (sid !== f.sourceId) {
        set.sourceId = sid;
        newSourceId = sid;
        sourceChanged = true;
      }
    }
    if (r.lstepNumber !== undefined && r.lstepNumber !== f.lstepNumber) {
      set.lstepNumber = r.lstepNumber;
      lstepChanged = true;
    }
    if (Object.keys(set).length === 0) return;

    // 日時が未確定の人は日ごとの集計に入っていない。今回確定する場合は新規の追加、確定しない場合は集計に触れない
    let stats: (typeof updates)[number]["stats"] = null;
    if (f.estimated) {
      if ("addedAtEstimated" in set) stats = { prev: null, next: { addedAt: newAddedAt, sourceId: newSourceId } };
    } else if (newAddedAt !== f.addedAt || newSourceId !== f.sourceId) {
      stats = { prev: { addedAt: f.addedAt, sourceId: f.sourceId }, next: { addedAt: newAddedAt, sourceId: newSourceId } };
    }
    updates.push({ ref: f.ref, set, addedAtChanged, sourceChanged, lstepChanged, stats });
  });

  const summary = {
    matched: rows.length - notFound - duplicateId,
    notFound,
    notFoundSample,
    duplicateId,
    nameMismatch,
    nameMismatchSample,
    addedAtSkippedNormal,
    addedAtSkippedFuture,
    sourceUnmatched,
    sourceUnmatchedSample,
    addedAtUpdated: updates.filter((u) => u.addedAtChanged).length,
    sourceUpdated: updates.filter((u) => u.sourceChanged).length,
    lstepUpdated: updates.filter((u) => u.lstepChanged).length,
    updatedFriends: updates.length,
  };
  if (body?.check === true) return NextResponse.json({ ok: true, ...summary });

  const chunkSize = 400;
  for (let i = 0; i < updates.length; i += chunkSize) {
    const batch = adminDb.batch();
    updates.slice(i, i + chunkSize).forEach((u) => batch.set(u.ref, u.set, { merge: true }));
    await batch.commit();
  }
  const statsList = updates.flatMap((u) => (u.stats ? [u.stats] : []));
  if (statsList.length > 0) await recordFriendsChangedBulk(statsList);

  return NextResponse.json({ ok: true, ...summary });
}
