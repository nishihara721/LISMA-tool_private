// 流入経路(sources)と広告(purchase_links)は件数の少ない設定用コレクションで、レポートの集計のたびに全件が必要になる。
// 毎回Firestoreを読み込まないよう、サーバーのメモリに短時間だけ保持する。
// 流入経路・広告の登録/編集/削除のAPIからinvalidateSettingsCache()を呼んで即時に破棄するため、
// 同じサーバー内では編集直後から最新の内容が使われる。サーバーが複数台に分かれる環境でも、遅くともTTL後には反映される。
import { adminDb } from "./firebase-admin";
import type { PurchaseLinkDoc, SourceDoc } from "@/types";
import { invalidateReportCache } from "./report-cache";

const TTL_MS = 60_000;

type Name = "sources" | "purchase_links";
const cache = new Map<Name, { at: number; data: unknown[]; pending?: Promise<unknown[]> }>();

async function load<T>(name: Name): Promise<T[]> {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data as T[];
  // 同時に複数のレポートが呼ばれても、読み込みは1回にまとめる
  if (hit?.pending) return hit.pending as Promise<T[]>;
  const pending = adminDb
    .collection(name)
    .get()
    .then((snap) => {
      const data = snap.docs.map((d) => d.data());
      cache.set(name, { at: Date.now(), data });
      return data;
    })
    .catch((e) => {
      cache.delete(name);
      throw e;
    });
  cache.set(name, { at: hit?.at ?? 0, data: hit?.data ?? [], pending });
  return pending as Promise<T[]>;
}

export const getAllSources = () => load<SourceDoc>("sources");
export const getAllPurchaseLinks = () => load<PurchaseLinkDoc>("purchase_links");

export function invalidateSettingsCache() {
  cache.clear();
  // 流入経路・広告の名前や成果単価はレポートの集計結果にも反映されるため、レポートのキャッシュも破棄する
  invalidateReportCache();
}
