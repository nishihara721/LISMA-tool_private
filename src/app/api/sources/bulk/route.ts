import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { adminDb } from "@/lib/firebase-admin";
import { getAllSources, invalidateSettingsCache } from "@/lib/settings-cache";
import { buildSourceName } from "@/lib/source-name";
import type { SourceDoc } from "@/types";

export const maxDuration = 60;

// 流入経路の一括登録(CSV/Excelの取り込み)。1回の取り込みの上限はBULK_MAX_ROWS件。
// 名前は構成要素から自動生成し(1件ずつの登録と同じ規則)、すでに登録済みの名前、およびファイル内で重複する名前は登録しない。
// body: { rows: { placement, appeal, popup, scenario, exitPoint, intermediatePage, other, lstepUrl }[], check?: boolean }
//   check:true の場合は登録せず、登録される件数・スキップされる件数だけを返す(実行前の確認用)。
const BULK_MAX_ROWS = 1000; // Next.jsのルートファイルからは決まった名前以外をexportできないため、exportしない

type Row = {
  placement?: string;
  appeal?: string;
  popup?: string;
  scenario?: string;
  exitPoint?: string;
  intermediatePage?: string;
  other?: string;
  lstepUrl?: string;
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const rows = body?.rows as Row[] | undefined;
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "rowsは必須です" }, { status: 400 });
  }
  if (rows.length > BULK_MAX_ROWS) {
    return NextResponse.json(
      { error: `行数が多すぎます(${rows.length}行)。1回につき${BULK_MAX_ROWS}行以下になるよう、分けて取り込んでください` },
      { status: 400 }
    );
  }

  const existingNames = new Set((await getAllSources()).map((s) => s.name));
  const seen = new Set<string>();
  const toCreate: SourceDoc[] = [];
  let duplicate = 0; // 登録済み、またはファイル内で重複
  let empty = 0; // 全項目が空
  let invalidUrl = 0; // Lステップ流入経路リンクがURLの形式ではない(その行は登録しない)
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const now = Date.now();

  rows.forEach((r, i) => {
    const parts = {
      placement: str(r?.placement),
      appeal: str(r?.appeal),
      popup: str(r?.popup),
      scenario: str(r?.scenario),
      exitPoint: str(r?.exitPoint),
      intermediatePage: str(r?.intermediatePage),
      other: str(r?.other),
    };
    const name = buildSourceName(parts);
    if (!name) {
      empty++;
      return;
    }
    const lstepUrl = str(r?.lstepUrl);
    if (lstepUrl && !/^https?:\/\//.test(lstepUrl)) {
      invalidUrl++;
      return;
    }
    if (existingNames.has(name) || seen.has(name)) {
      duplicate++;
      return;
    }
    seen.add(name);
    toCreate.push({
      sourceId: nanoid(8),
      name,
      placement: parts.placement || undefined,
      appeal: parts.appeal || undefined,
      popup: parts.popup || undefined,
      scenario: parts.scenario || undefined,
      exitPoint: parts.exitPoint || undefined,
      intermediatePage: parts.intermediatePage || undefined,
      other: parts.other || undefined,
      lstepUrl: lstepUrl || undefined,
      // 取り込み順に一覧(新しい順)へ並ぶよう、1ミリ秒ずつずらす
      createdAt: now + i,
    });
  });

  const summary = { total: rows.length, create: toCreate.length, duplicate, empty, invalidUrl };
  if (body?.check === true) return NextResponse.json({ ok: true, ...summary });

  const chunkSize = 400;
  for (let i = 0; i < toCreate.length; i += chunkSize) {
    const batch = adminDb.batch();
    toCreate.slice(i, i + chunkSize).forEach((s) => {
      // undefinedの項目はFirestoreに書けないため取り除く
      batch.set(adminDb.collection("sources").doc(s.sourceId), Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)));
    });
    await batch.commit();
  }
  if (toCreate.length > 0) invalidateSettingsCache();

  return NextResponse.json({ ok: true, ...summary });
}
