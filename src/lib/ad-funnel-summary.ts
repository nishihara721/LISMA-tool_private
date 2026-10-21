// 月次レポートの集計で共通に使う、PV数〜CVRの合算ロジック。
// サーバー専用の依存(Firebase等)を持たないため、サーバー側の集計(report-monthly.ts)と、画面側(期間合計の計算)の両方から使える。
// PV数・imp数・CL数・友だち追加数・CV数を持つ行の配列から、
// 日次レポート画面の「月ごとの総計行」と同じ考え方で合算値(imp率・CL率・友だち追加率・CVRも含む)を計算する。
export function summarizeAdFunnelRows<
  T extends { pvCount: number | null; impCount: number | null; clCount: number | null; friendCount: number; cvCount: number; billingAmount: number }
>(rows: T[]) {
  const pv = rows.some((r) => r.pvCount !== null) ? rows.reduce((sum, r) => sum + (r.pvCount ?? 0), 0) : null;
  const imp = rows.some((r) => r.impCount !== null) ? rows.reduce((sum, r) => sum + (r.impCount ?? 0), 0) : null;
  const impRate = imp !== null && pv !== null && pv > 0 ? Math.round((imp / pv) * 1000) / 10 : null;
  const cl = rows.some((r) => r.clCount !== null) ? rows.reduce((sum, r) => sum + (r.clCount ?? 0), 0) : null;
  const clRate = cl !== null && imp !== null && imp > 0 ? Math.round((cl / imp) * 1000) / 10 : null;
  const friend = rows.reduce((sum, r) => sum + r.friendCount, 0);
  const friendAddRate = cl !== null && cl > 0 ? Math.round((friend / cl) * 1000) / 10 : null;
  const cv = rows.reduce((sum, r) => sum + r.cvCount, 0);
  const cvr = friend > 0 ? Math.round((cv / friend) * 1000) / 10 : null;
  const billing = rows.reduce((sum, r) => sum + r.billingAmount, 0);
  return { pv, imp, impRate, cl, clRate, friend, friendAddRate, cv, cvr, billing };
}
