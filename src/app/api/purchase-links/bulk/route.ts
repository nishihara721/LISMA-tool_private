import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { adminDb } from "@/lib/firebase-admin";
import { invalidateSettingsCache } from "@/lib/settings-cache";
import { buildPurchaseLinkName, ordinal } from "@/lib/purchase-link-name";
import type { PurchaseLinkDoc } from "@/types";

export const maxDuration = 60;

// 広告の一括登録(CSVの取り込み)。1回の取り込みの上限はBULK_MAX_ROWS件。
// 名前は構成要素から自動生成し(1件ずつの登録と同じ規則)、すでに登録済みの名前、およびファイル内で重複する名前は登録しない。
// body: { rows: { scenario, messageCount, other, unitPrice, destinationUrl, liffId }[], check?: boolean }
//   scenario: 数字(「1」。「1st」のような序数表記でも可)/ messageCount: 数字(「500」。「500通目」でも可)
//   check:true の場合は登録せず、登録される件数・スキップされる件数だけを返す(実行前の確認用)。
const BULK_MAX_ROWS = 1000;

type Row = {
  scenario?: string;
  messageCount?: string;
  other?: string;
  unitPrice?: string;
  destinationUrl?: string;
  liffId?: string;
};

// 「1」「1st」「500通目」「1,000」などから、先頭の数値だけを取り出す。数値として読めなければ null。空欄は undefined。
function parseCount(v: string): number | null | undefined {
  const t = v.normalize("NFKC").replace(/[,\s]/g, "");
  if (t === "") return undefined;
  const m = t.match(/^(\d+)(st|nd|rd|th|通目|通)?$/i);
  return m ? Number(m[1]) : null;
}

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

  const existingSnap = await adminDb.collection("purchase_links").select("name").get();
  const existingNames = new Set(existingSnap.docs.map((d) => String(d.get("name") ?? "")));
  const seen = new Set<string>();
  const toCreate: PurchaseLinkDoc[] = [];
  let duplicate = 0; // 登録済み、またはファイル内で重複
  let empty = 0; // 全項目が空
  let invalidNumber = 0; // シナリオ・通数・成果単価が数値として読めない
  let invalidUrl = 0; // 遷移先URLがURLの形式ではない、またはLIFF IDが空
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const now = Date.now();

  rows.forEach((r, i) => {
    const scenarioNum = parseCount(str(r?.scenario));
    const messageCountNum = parseCount(str(r?.messageCount));
    const other = str(r?.other);
    const unitPriceText = str(r?.unitPrice).normalize("NFKC").replace(/[,\s円]/g, "");
    const destinationUrl = str(r?.destinationUrl);
    const liffId = str(r?.liffId);

    if (scenarioNum === undefined && messageCountNum === undefined && !other && !unitPriceText && !destinationUrl && !liffId) {
      empty++;
      return;
    }
    if (scenarioNum === null || messageCountNum === null) {
      invalidNumber++;
      return;
    }
    let unitPrice: number | undefined;
    if (unitPriceText !== "") {
      unitPrice = Number(unitPriceText);
      if (Number.isNaN(unitPrice) || unitPrice < 0) {
        invalidNumber++;
        return;
      }
    }
    const name = buildPurchaseLinkName({
      scenario: scenarioNum !== undefined ? ordinal(scenarioNum) : undefined,
      messageCount: messageCountNum,
      other,
    });
    if (!name) {
      empty++;
      return;
    }
    if (!/^https?:\/\//.test(destinationUrl) || !liffId) {
      invalidUrl++;
      return;
    }
    if (existingNames.has(name) || seen.has(name)) {
      duplicate++;
      return;
    }
    seen.add(name);
    toCreate.push({
      purchaseLinkId: nanoid(8),
      name,
      scenario: scenarioNum !== undefined ? ordinal(scenarioNum) : undefined,
      messageCount: messageCountNum,
      other: other || undefined,
      unitPrice,
      destinationUrl,
      liffId,
      // 取り込み順に一覧(新しい順)へ並ぶよう、1ミリ秒ずつずらす
      createdAt: now + i,
    });
  });

  const summary = { total: rows.length, create: toCreate.length, duplicate, empty, invalidNumber, invalidUrl };
  if (body?.check === true) return NextResponse.json({ ok: true, ...summary });

  const chunkSize = 400;
  for (let i = 0; i < toCreate.length; i += chunkSize) {
    const batch = adminDb.batch();
    toCreate.slice(i, i + chunkSize).forEach((p) => {
      // undefinedの項目はFirestoreに書けないため取り除く
      batch.set(adminDb.collection("purchase_links").doc(p.purchaseLinkId), Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)));
    });
    await batch.commit();
  }
  if (toCreate.length > 0) invalidateSettingsCache();

  return NextResponse.json({ ok: true, ...summary });
}
