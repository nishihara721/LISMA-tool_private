import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import type { ConversionDoc, ReportCvEntryDoc } from "@/types";
import { applyStatsDeltas, cvDelta, importCvDelta } from "@/lib/daily-stats";
import { invalidateReportCache } from "@/lib/report-cache";

// 編集用成果ログ画面での「非表示にする/表示に戻す」操作(1件ずつのボタン・CSVでのID一覧どちらからも呼ぶ)。
//
// body: { hidden: boolean, items: { id: string, kind: "auto" | "import", convertedAt: number }[] }
//
// kind: "auto" の場合、report_cv_entriesに対応するドキュメントがまだ存在しないことがあるため、
// (=これまで一度も非表示操作をしたことがない自動計測成果)、その場合は新規作成する。
// kind: "import" の場合は、report_cv_entries自体がその成果の実体なので、既存ドキュメントのhiddenだけ更新する。
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const hidden = body?.hidden;
  const items = body?.items as { id: string; kind: "auto" | "import"; convertedAt: number }[] | undefined;

  if (typeof hidden !== "boolean" || !items || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "hidden・itemsは必須です" }, { status: 400 });
  }

  const refs = items.map((item) => adminDb.collection("report_cv_entries").doc(item.id));
  const existingSnaps = await adminDb.getAll(...refs);
  const existingMap = new Map(existingSnaps.map((s) => [s.id, s.exists ? (s.data() as ReportCvEntryDoc) : undefined]));

  const now = Date.now();
  const batch = adminDb.batch();
  items.forEach((item) => {
    const existing = existingMap.get(item.id);
    const entry: ReportCvEntryDoc = {
      id: item.id,
      kind: item.kind,
      hidden,
      convertedAt: existing?.convertedAt ?? item.convertedAt,
      note: existing?.note,
      sourceName: existing?.sourceName,
      purchaseLinkName: existing?.purchaseLinkName,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    batch.set(adminDb.collection("report_cv_entries").doc(item.id), entry);
  });
  await batch.commit();

  // 日ごとの集計(daily_stats)の件数を、表示状態が実際に変わったものだけ増減する(非表示→-1、表示に戻す→+1)
  const changed = items.filter((item) => (existingMap.get(item.id)?.hidden ?? false) !== hidden);
  const autoItems = changed.filter((item) => item.kind === "auto");
  const convSnaps = autoItems.length > 0
    ? await adminDb.getAll(...autoItems.map((item) => adminDb.collection("conversions").doc(item.id)))
    : [];
  const convMap = new Map(convSnaps.filter((s) => s.exists).map((s) => [s.id, s.data() as ConversionDoc]));
  const delta = hidden ? -1 : 1;
  await applyStatsDeltas(
    changed.flatMap((item) => {
      const existing = existingMap.get(item.id);
      if (item.kind === "import") {
        return [importCvDelta(existing?.convertedAt ?? item.convertedAt, existing?.purchaseLinkName, delta)];
      }
      const conv = convMap.get(item.id);
      return conv ? [cvDelta(conv.convertedAt, conv, delta)] : [];
    })
  );
  invalidateReportCache();

  return NextResponse.json({ ok: true, updated: items.length });
}
