import { NextResponse, type NextRequest } from "next/server";

// レポートAPIの結果を、サーバーのメモリに短時間だけ保持する。
// 同じ期間のレポートを何度開いても(別の画面から開き直しても)、Firestoreを読み込むのは最初の1回だけになる。
//
// ・取り込み(imp数・CL数・PV数・成果の追加/非表示)や、流入経路・広告の登録/編集のAPIからinvalidateReportCache()を
//   呼んで即時に破棄するため、画面からの操作は直後のレポートにすぐ反映される。
// ・友だち追加・成果の自動計測(LINE Webhook・計測API)では破棄しないため、新しい友だち追加・成果が
//   レポートに反映されるのは、最長でTTL(既定2分)後になる。
// ・サーバーが複数台に分かれる環境(Vercel等)では、台ごとに保持するため、他の台での操作の反映も最長でTTL後になる。

const TTL_MS = 120_000;
const MAX_ENTRIES = 200;

const store = new Map<string, { at: number; value?: unknown; pending?: Promise<unknown> }>();

export async function cachedReport<T>(key: string, compute: () => Promise<T>, ttlMs = TTL_MS): Promise<T> {
  const hit = store.get(key);
  if (hit) {
    if (hit.pending) return hit.pending as Promise<T>; // 同時に同じレポートが呼ばれても、計算は1回にまとめる
    if (Date.now() - hit.at < ttlMs) return hit.value as T;
  }

  if (store.size >= MAX_ENTRIES) {
    // 古いものから捨てる(キーが際限なく増えてメモリを圧迫しないように)
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }

  const pending = compute()
    .then((value) => {
      // 計算中に破棄(invalidate)されていた場合は、古い可能性があるため保持しない
      if (store.get(key)?.pending === pending) store.set(key, { at: Date.now(), value });
      return value;
    })
    .catch((e) => {
      if (store.get(key)?.pending === pending) store.delete(key);
      throw e;
    });
  store.set(key, { at: 0, pending });
  return pending;
}

export function invalidateReportCache() {
  store.clear();
}

// レポートのAPIルート用。同じURL(期間のクエリを含む)へのリクエスト結果を短時間キャッシュして返す。
export async function cachedReportRoute(req: NextRequest, compute: (req: NextRequest) => Promise<NextResponse>) {
  const key = req.nextUrl.pathname + req.nextUrl.search;
  const r = await cachedReport(key, async () => {
    const res = await compute(req);
    return { status: res.status, body: await res.json() };
  });
  return NextResponse.json(r.body, { status: r.status });
}
