import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { LSTEP_IMPORT_MAX_FRIENDS, LSTEP_IMPORT_MAX_ROWS, lstepImportRange } from "@/lib/lstep-period";

// Vercelの実行時間の上限(秒)。件数が多くても途中で打ち切られないよう、余裕を持たせる
export const maxDuration = 60;

// Lステップ側からエクスポートしたCSVをもとに、友だち一覧の各友だちに「Lステップナンバー」を付与する。
// 突合ルール:
//   1. 表示名が完全一致していること
//   2. 1.の候補が複数いる場合は、友だち追加日時が一致、もしくは最も近いものを採用する
//   (1人の友だちには1つの番号だけ。同名の行と友だちは、追加日時の差が小さい組み合わせから順に1対1で割り当てる)
//
// 読み込む友だちは、CSVの「友だち追加日時」の最小〜最大(前後1日の余裕つき)の期間に追加された友だちだけ。
// 友だち全件を読み込むと、友だちが増えるほど読み取り件数が増えてしまうため。
// 期間内の友だちがLSTEP_IMPORT_MAX_FRIENDS人を超える場合は、期間を分けて取り込んでもらうため実行しない。
//
// body: { rows: { displayName, addedAt(ミリ秒), lstepNumber }[], check?: boolean }
//   check:true の場合は、突合も書き込みもせず、対象期間と期間内の友だち数だけを返す(取り込み前の確認用)。
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const rows = body?.rows as { displayName: string; addedAt: number; lstepNumber: string }[] | undefined;

  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "rowsは必須です" }, { status: 400 });
  }
  if (rows.length > LSTEP_IMPORT_MAX_ROWS) {
    return NextResponse.json(
      { error: `CSVの行数が多すぎます(${rows.length}行)。${LSTEP_IMPORT_MAX_ROWS}行以下になるよう、期間を分けて取り込んでください` },
      { status: 400 }
    );
  }
  if (rows.some((r) => !r || typeof r.displayName !== "string" || typeof r.lstepNumber !== "string" || !Number.isFinite(r.addedAt))) {
    return NextResponse.json({ error: "rowsの形式が不正です" }, { status: 400 });
  }

  const { from, to, minAt, maxAt } = lstepImportRange(rows.map((r) => r.addedAt));
  const base = adminDb.collection("friends").where("addedAt", ">=", from).where("addedAt", "<=", to);

  // 読み込む前に、期間内の友だち数を件数集計(count)で数える(1,000件あたり読み取り1件分)
  const friendCount = (await base.count().get()).data().count;
  if (friendCount > LSTEP_IMPORT_MAX_FRIENDS) {
    return NextResponse.json(
      {
        error: `対象期間に追加された友だちが${friendCount.toLocaleString()}人います(上限${LSTEP_IMPORT_MAX_FRIENDS.toLocaleString()}人)。期間を分けて取り込んでください`,
        code: "too_many_friends",
        friendCount,
        minAt,
        maxAt,
      },
      { status: 400 }
    );
  }
  if (body?.check === true) {
    return NextResponse.json({ ok: true, friendCount, minAt, maxAt });
  }

  const snap = await base.select("displayName", "addedAt").get();
  const friends = snap.docs.map((d) => ({
    ref: d.ref,
    displayName: d.get("displayName") as string | undefined,
    addedAt: d.get("addedAt") as number,
  }));

  // 表示名ごとに候補をグルーピングしておく(完全一致した友だちの中から日時が近いものを選ぶため)
  const byName = new Map<string, typeof friends>();
  friends.forEach((f) => {
    if (!f.displayName) return;
    const list = byName.get(f.displayName) ?? [];
    list.push(f);
    byName.set(f.displayName, list);
  });

  // 表示名ごとに、(CSVの行, 友だち)の全組み合わせを追加日時の差が小さい順に並べ、近いものから1対1で割り当てる。
  // (CSVの行の並び順に左右されず、同名の友だちが複数いても、一致・最も近いもの同士が組み合わさる)
  const rowsByName = new Map<string, typeof rows>();
  rows.forEach((r) => {
    const list = rowsByName.get(r.displayName) ?? [];
    list.push(r);
    rowsByName.set(r.displayName, list);
  });

  let matched = 0;
  const unmatchedRows: { displayName: string; lstepNumber: string }[] = [];
  const updates: { ref: (typeof friends)[number]["ref"]; lstepNumber: string }[] = [];

  rowsByName.forEach((nameRows, name) => {
    const candidates = byName.get(name) ?? [];
    const pairs: { ri: number; ci: number; diff: number }[] = [];
    nameRows.forEach((r, ri) =>
      candidates.forEach((c, ci) => pairs.push({ ri, ci, diff: Math.abs(c.addedAt - r.addedAt) }))
    );
    pairs.sort((x, y) => x.diff - y.diff);
    const usedRows = new Set<number>();
    const usedCandidates = new Set<number>();
    for (const p of pairs) {
      if (usedRows.has(p.ri) || usedCandidates.has(p.ci)) continue;
      usedRows.add(p.ri);
      usedCandidates.add(p.ci);
      updates.push({ ref: candidates[p.ci].ref, lstepNumber: nameRows[p.ri].lstepNumber });
      matched++;
    }
    nameRows.forEach((r, ri) => {
      if (!usedRows.has(ri)) unmatchedRows.push({ displayName: r.displayName, lstepNumber: r.lstepNumber });
    });
  });

  // Firestoreの1バッチあたりの上限(500)に余裕を持たせて分けて書き込む
  const chunkSize = 400;
  for (let i = 0; i < updates.length; i += chunkSize) {
    const batch = adminDb.batch();
    updates.slice(i, i + chunkSize).forEach((u) => batch.set(u.ref, { lstepNumber: u.lstepNumber }, { merge: true }));
    await batch.commit();
  }

  return NextResponse.json({
    ok: true,
    matched,
    unmatched: unmatchedRows.length,
    unmatchedSample: unmatchedRows.slice(0, 10),
    friendCount,
    minAt,
    maxAt,
  });
}
