import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import type { ConversionDoc, ReportCvEntryDoc } from "@/types";
import { applyStatsDeltas, cvDelta, importCvDelta } from "@/lib/daily-stats";
import { invalidateReportCache } from "@/lib/report-cache";

export const maxDuration = 60;

const MAX_IDS = 5000;
const CHUNK = 300;

// 編集用成果ログ画面での「非表示にする/表示に戻す」操作(1件ずつのボタン・選択した行・CSVでのID一覧のいずれからも呼ぶ)。
//
// body: { hidden: boolean, ids: string[] }   idsは成果のID(編集用成果ログの「ID」列の値)
//
// 成果の種類(自動計測/手動追加)・成果日時はサーバー側でIDから調べるため、画面に読み込んでいない期間の成果も指定できる。
// 自動計測の成果は、report_cv_entriesにまだ上書き情報が無い(=一度も非表示操作をしていない)場合は新規作成する。
// 手動追加の成果は、report_cv_entries自体が成果の実体なので、既存ドキュメントのhiddenだけ更新する。
// どちらにも該当しないIDは更新せず、notFound として件数を返す。
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const hidden = body?.hidden;
  const rawIds = body?.ids;

  if (typeof hidden !== "boolean" || !Array.isArray(rawIds) || rawIds.length === 0 || rawIds.some((i) => typeof i !== "string")) {
    return NextResponse.json({ error: "hidden・idsは必須です" }, { status: 400 });
  }
  const ids = Array.from(new Set((rawIds as string[]).map((i) => i.trim()).filter((i) => i && !i.includes("/"))));
  if (ids.length === 0) return NextResponse.json({ error: "有効なIDがありません" }, { status: 400 });
  if (ids.length > MAX_IDS) {
    return NextResponse.json({ error: `IDが多すぎます(${ids.length}件)。${MAX_IDS}件以下に分けて指定してください` }, { status: 400 });
  }

  let updated = 0;
  let notFound = 0;
  const now = Date.now();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    const [ovSnaps, convSnaps] = await Promise.all([
      adminDb.getAll(...part.map((id) => adminDb.collection("report_cv_entries").doc(id))),
      adminDb.getAll(...part.map((id) => adminDb.collection("conversions").doc(id))),
    ]);
    const batch = adminDb.batch();
    const deltas: ReturnType<typeof cvDelta>[] = [];
    part.forEach((id, idx) => {
      const existing = ovSnaps[idx].exists ? (ovSnaps[idx].data() as ReportCvEntryDoc) : undefined;
      const conv = convSnaps[idx].exists ? (convSnaps[idx].data() as ConversionDoc) : undefined;
      // 手動追加の成果、または自動計測の成果のどちらかとして存在するIDだけを対象にする
      const isImport = existing?.kind === "import";
      if (!isImport && !conv) {
        notFound++;
        return;
      }
      const entry: ReportCvEntryDoc = {
        id,
        kind: isImport ? "import" : "auto",
        hidden,
        convertedAt: existing?.convertedAt ?? conv!.convertedAt,
        note: existing?.note,
        sourceName: existing?.sourceName,
        purchaseLinkName: existing?.purchaseLinkName,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      batch.set(adminDb.collection("report_cv_entries").doc(id), entry);
      updated++;
      // 日ごとの集計(daily_stats)の件数は、表示状態が実際に変わったものだけ増減する(非表示→-1、表示に戻す→+1)
      if ((existing?.hidden ?? false) !== hidden) {
        const delta = hidden ? -1 : 1;
        deltas.push(isImport ? importCvDelta(entry.convertedAt, existing?.purchaseLinkName, delta) : cvDelta(conv!.convertedAt, conv!, delta));
      }
    });
    await batch.commit();
    if (deltas.length > 0) await applyStatsDeltas(deltas);
  }
  invalidateReportCache();

  return NextResponse.json({ ok: true, updated, notFound });
}
