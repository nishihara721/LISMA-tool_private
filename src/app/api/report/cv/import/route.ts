import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { adminDb } from "@/lib/firebase-admin";
import type { ReportCvEntryDoc } from "@/types";
import { applyStatsDeltas, importCvDelta } from "@/lib/daily-stats";
import { invalidateReportCache } from "@/lib/report-cache";

// CSVインポートによる成果の手動追加。
// body: { rows: { convertedAt: number, note?: string, sourceName?: string, purchaseLinkName?: string }[] }
//
// ここで作られるドキュメントは kind: "import" として保存され、conversionsコレクション自体には
// 一切書き込まない(自動計測ログとは完全に独立させ、後から見分けがつくようにするため)。
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const rows = body?.rows as
    | { convertedAt: number; note?: string; sourceName?: string; purchaseLinkName?: string }[]
    | undefined;

  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "rowsは必須です" }, { status: 400 });
  }
  if (rows.some((r) => typeof r.convertedAt !== "number" || Number.isNaN(r.convertedAt))) {
    return NextResponse.json({ error: "成果日時(convertedAt)が不正な行があります" }, { status: 400 });
  }

  const now = Date.now();
  const batch = adminDb.batch();
  rows.forEach((r) => {
    const entry: ReportCvEntryDoc = {
      id: nanoid(10),
      kind: "import",
      hidden: false,
      convertedAt: r.convertedAt,
      note: r.note,
      sourceName: r.sourceName,
      purchaseLinkName: r.purchaseLinkName,
      createdAt: now,
      updatedAt: now,
    };
    batch.set(adminDb.collection("report_cv_entries").doc(entry.id), entry);
  });
  await batch.commit();
  await applyStatsDeltas(rows.map((r) => importCvDelta(r.convertedAt, r.purchaseLinkName, 1)));
  invalidateReportCache();

  return NextResponse.json({ ok: true, imported: rows.length });
}
