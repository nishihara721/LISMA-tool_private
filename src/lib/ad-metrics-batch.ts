import { nanoid } from "nanoid";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { invalidateReportCache } from "@/lib/report-cache";

// Flipdeskのimp数・CL数のCSV取り込みを、まとめて1回の「取り込み」として記録し、あとから取り消せるようにする。
//
// ・取り込みの前に、書き込み先の各ドキュメントの「imp数・CL数の元の値」を控えておく(ad_metrics_imports/{id}/snapshots)。
// ・取り消しでは、控えた値に戻す(imp数・CL数の2項目だけ。PV数やメモなど、ほかの項目は触らない)。
//   この取り込みで新しく作られたドキュメントは、ほかの値が入っていなければ削除する。
// ・取り消せるのは、まだ取り消していない取り込みのうち、一番新しい1件だけ。
//   (古い取り込みを先に取り消すと、あとの取り込みで上書きされた値と食い違うため、新しいものから順に取り消す)

export type AdMetricsImportPayload = {
  byDate: { date: string; impCount: number; clCount: number }[];
  byPopup?: { date: string; popup: string; impCount: number; clCount: number }[];
  byScenario?: { date: string; scenario: string; impCount: number; clCount: number }[];
  byExitPoint?: { date: string; exitPoint: string; impCount: number; clCount: number }[];
  byAppeal?: { date: string; appeal: string; impCount: number; clCount: number }[];
  bySource?: { date: string; sourceName: string; impCount: number; clCount: number }[];
  byPopupScenario?: { date: string; label: string; impCount: number; clCount: number }[];
};

type Target = { collection: string; nameField: string | null; docId: (date: string, name: string) => string };
const enc = (date: string, name: string) => `${date}__${encodeURIComponent(name)}`;
const TARGETS: Record<keyof AdMetricsImportPayload, Target> = {
  byDate: { collection: "daily_ad_metrics", nameField: null, docId: (d) => d },
  byPopup: { collection: "daily_popup_ad_metrics", nameField: "popup", docId: enc },
  byScenario: { collection: "daily_scenario_ad_metrics", nameField: "scenario", docId: enc },
  byExitPoint: { collection: "daily_exit_point_ad_metrics", nameField: "exitPoint", docId: enc },
  byAppeal: { collection: "daily_appeal_ad_metrics", nameField: "appeal", docId: enc },
  bySource: { collection: "daily_source_ad_metrics", nameField: "sourceName", docId: enc },
  byPopupScenario: { collection: "daily_popup_scenario_ad_metrics", nameField: "label", docId: enc },
};
const KEYS = Object.keys(TARGETS) as (keyof AdMetricsImportPayload)[];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BATCH = 400;
const SNAPSHOT_CHUNK = 400;

type Write = { collection: string; docId: string; data: Record<string, unknown> };
type Snapshot = { c: string; d: string; e: boolean; i: number | null; l: number | null };

export type AdMetricsImportRecord = {
  importId: string;
  createdAt: number;
  createdBy: string;
  fileName: string;
  dateFrom: string;
  dateTo: string;
  counts: Record<string, number>;
  status: "applying" | "applied" | "undone";
  undoneAt?: number;
  undoneBy?: string;
};

export function validatePayload(p: unknown): string | null {
  if (!p || typeof p !== "object") return "取り込む内容がありません";
  const payload = p as Record<string, unknown>;
  if (!Array.isArray(payload.byDate) || payload.byDate.length === 0) return "byDate(日次の取り込み内容)は必須です";
  for (const key of KEYS) {
    const rows = payload[key];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) return `${key}の形式が不正です`;
    const nameField = TARGETS[key].nameField;
    for (const r of rows as Record<string, unknown>[]) {
      if (typeof r?.date !== "string" || !DATE_RE.test(r.date)) return "dateの形式が不正な行があります(YYYY-MM-DD)";
      if (nameField && (typeof r[nameField] !== "string" || !(r[nameField] as string).trim())) return `${nameField}が空の行があります`;
      if (typeof r.impCount !== "number" || typeof r.clCount !== "number") return "imp数・CL数が数値でない行があります";
    }
  }
  return null;
}

function buildWrites(payload: AdMetricsImportPayload, now: number): Write[] {
  const writes: Write[] = [];
  const seen = new Set<string>();
  for (const key of KEYS) {
    const t = TARGETS[key];
    for (const r of (payload[key] ?? []) as Record<string, unknown>[]) {
      const date = r.date as string;
      const name = t.nameField ? (r[t.nameField] as string).trim() : "";
      const docId = t.docId(date, name);
      const id = `${t.collection}/${docId}`;
      if (seen.has(id)) continue; // 同じドキュメントへの書き込みが重複していても、最初の1件だけ使う
      seen.add(id);
      writes.push({
        collection: t.collection,
        docId,
        data: { date, ...(t.nameField ? { [t.nameField]: name } : {}), impCount: r.impCount, clCount: r.clCount, updatedAt: now },
      });
    }
  }
  return writes;
}

async function getAllSnaps(refs: FirebaseFirestore.DocumentReference[]) {
  const out: FirebaseFirestore.DocumentSnapshot[] = [];
  for (let i = 0; i < refs.length; i += 300) {
    out.push(...(await adminDb.getAll(...refs.slice(i, i + 300))));
  }
  return out;
}

export async function applyAdMetricsImport(
  payload: AdMetricsImportPayload,
  info: { fileName: string; createdBy: string }
): Promise<AdMetricsImportRecord> {
  const now = Date.now();
  const writes = buildWrites(payload, now);

  // 1. 書き込み前の値を控える
  const snaps = await getAllSnaps(writes.map((w) => adminDb.collection(w.collection).doc(w.docId)));
  const snapshots: Snapshot[] = snaps.map((s, idx) => {
    const d = s.exists ? (s.data() as { impCount?: number; clCount?: number }) : undefined;
    return { c: writes[idx].collection, d: writes[idx].docId, e: s.exists, i: d?.impCount ?? null, l: d?.clCount ?? null };
  });

  const dates = payload.byDate.map((r) => r.date).sort();
  const importId = nanoid(12);
  const counts: Record<string, number> = {};
  KEYS.forEach((k) => {
    counts[k] = (payload[k] ?? []).length;
  });
  const record: AdMetricsImportRecord = {
    importId,
    createdAt: now,
    createdBy: info.createdBy,
    fileName: info.fileName,
    dateFrom: dates[0],
    dateTo: dates[dates.length - 1],
    counts,
    status: "applying",
  };

  // 2. 履歴と、控えた値を保存してから、実際に書き込む(途中で失敗しても、控えがあるため取り消しで元に戻せる)
  const histRef = adminDb.collection("ad_metrics_imports").doc(importId);
  await histRef.set(record);
  for (let i = 0; i < snapshots.length; i += SNAPSHOT_CHUNK) {
    await histRef.collection("snapshots").doc(String(i / SNAPSHOT_CHUNK)).set({ items: snapshots.slice(i, i + SNAPSHOT_CHUNK) });
  }
  for (let i = 0; i < writes.length; i += BATCH) {
    const batch = adminDb.batch();
    writes.slice(i, i + BATCH).forEach((w) => batch.set(adminDb.collection(w.collection).doc(w.docId), w.data, { merge: true }));
    await batch.commit();
  }
  record.status = "applied";
  await histRef.update({ status: "applied" });

  invalidateReportCache();
  return record;
}

export async function listAdMetricsImports(limit = 20) {
  const snap = await adminDb.collection("ad_metrics_imports").orderBy("createdAt", "desc").limit(limit).get();
  const records = snap.docs.map((d) => d.data() as AdMetricsImportRecord);
  const latestActive = records.find((r) => r.status !== "undone")?.importId ?? null;
  return { records, latestActiveId: latestActive };
}

export async function undoAdMetricsImport(importId: string, by: string): Promise<{ ok: true; restored: number } | { ok: false; error: string; status: number }> {
  const histRef = adminDb.collection("ad_metrics_imports").doc(importId);
  const histSnap = await histRef.get();
  if (!histSnap.exists) return { ok: false, error: "取り込みの記録が見つかりません", status: 404 };
  const rec = histSnap.data() as AdMetricsImportRecord;
  if (rec.status === "undone") return { ok: false, error: "すでに取り消されています", status: 409 };

  // 取り消せるのは、取り消していない取り込みのうち一番新しいもの
  const latest = await adminDb.collection("ad_metrics_imports").orderBy("createdAt", "desc").limit(50).get();
  const newestActive = latest.docs.map((d) => d.data() as AdMetricsImportRecord).find((r) => r.status !== "undone");
  if (newestActive && newestActive.importId !== importId) {
    return { ok: false, error: "新しい取り込みから順に取り消してください(先に、より新しい取り込みを取り消す必要があります)", status: 409 };
  }

  const snapDocs = await histRef.collection("snapshots").get();
  const items: Snapshot[] = snapDocs.docs.flatMap((d) => (d.data().items ?? []) as Snapshot[]);

  const nameFields = new Set(Object.values(TARGETS).map((t) => t.nameField).filter(Boolean) as string[]);
  const systemKeys = new Set(["date", "updatedAt", "impCount", "clCount", ...nameFields]);

  let restored = 0;
  for (let i = 0; i < items.length; i += BATCH) {
    const chunk = items.slice(i, i + BATCH);
    const refs = chunk.map((it) => adminDb.collection(it.c).doc(it.d));
    const current = await getAllSnaps(refs);
    const batch = adminDb.batch();
    chunk.forEach((it, idx) => {
      const cur = current[idx];
      if (!cur.exists) return; // すでに無い(手動で削除された等)場合は何もしない
      if (it.e) {
        batch.update(refs[idx], {
          impCount: it.i === null ? FieldValue.delete() : it.i,
          clCount: it.l === null ? FieldValue.delete() : it.l,
        });
      } else {
        // この取り込みで新しく作られたドキュメント。PV数・メモなど、ほかの値が入っていなければ削除し、入っていればimp数・CL数だけ消す
        const hasOther = Object.keys(cur.data() ?? {}).some((k) => !systemKeys.has(k));
        if (hasOther) batch.update(refs[idx], { impCount: FieldValue.delete(), clCount: FieldValue.delete() });
        else batch.delete(refs[idx]);
      }
      restored++;
    });
    await batch.commit();
  }

  await histRef.update({ status: "undone", undoneAt: Date.now(), undoneBy: by });
  invalidateReportCache();
  return { ok: true, restored };
}
