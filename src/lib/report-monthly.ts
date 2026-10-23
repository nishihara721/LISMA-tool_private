// 月次レポート(合算・ポップアップ別・ポップアップ×シナリオ別・
// 設置先×訴求×離脱地点×ポップアップ×シナリオ×中間別)で共通して使う、月単位への集計ロジック。
//
// 月次レポートは閲覧専用(PV数・imp数・CL数の手動編集はできない)。
// PV数・imp数・CL数はCSV取り込みで得られる「日次」のデータを月単位に合算して表示する
// (合算の月次レポート・ポップアップ別月次レポートのみ対応。
//  ポップアップ×シナリオ別・6要素組み合わせ別は、その粒度でのPV数・imp数・CL数の取り込みが無いため、
//  友だち追加数・CV数・CVRのみを表示する)。
import { summarizeAdFunnelRows } from "./ad-funnel-summary";
import { monthKeyOf } from "./monthly-totals";
import {
  dateKeyJST,
  type DailyReportRow,
  type EffectiveCvEntry,
  type PopupDailyReportRow,
} from "./report-cv";
import type { FriendDoc } from "@/types";

// "YYYY-MM"の月キーの末尾(その月の最終日)を"YYYY-MM-DD"で返す
function lastDateKeyOfMonth(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  // 翌月の1日から1日引く = 当月の末日(JSのDateはタイムゾーンに関わらず「暦の計算」として使う)
  const d = new Date(Date.UTC(year, month, 0));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// 月範囲(fromMonth〜toMonth、両端含む、"YYYY-MM")を、対応する日付範囲("YYYY-MM-DD")に変換する
export { summarizeAdFunnelRows };

export function monthRangeToDateKeys(fromMonth: string, toMonth: string): { fromDateKey: string; toDateKey: string } {
  return { fromDateKey: `${fromMonth}-01`, toDateKey: lastDateKeyOfMonth(toMonth) };
}

// 月範囲(両端含む)に含まれるすべての月キー("YYYY-MM")を、古い順に列挙する
export function enumerateMonthKeys(fromMonth: string, toMonth: string): string[] {
  const keys: string[] = [];
  const [fy, fm] = fromMonth.split("-").map(Number);
  const [ty, tm] = toMonth.split("-").map(Number);
  let y = fy;
  let m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    keys.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return keys;
}

export type MonthlyReportRow = {
  month: string; // YYYY-MM
  pvCount: number | null;
  impCount: number | null;
  impRate: number | null;
  clCount: number | null;
  clRate: number | null;
  friendCount: number;
  friendAddRate: number | null;
  cvCount: number;
  cvr: number | null;
  billingAmount: number; // 請求額(円)
};

// 合算の月次レポート。日次レポートと同じ集計ロジック(buildDailyReportが作る日ごとの行)を
// 月ごとにグループ化して合算することで、日次側のPV数フォールバック等のロジックと食い違いが出ないようにしている。
export function buildMonthlyReport(dailyRows: DailyReportRow[], fromMonth: string, toMonth: string): MonthlyReportRow[] {
  const byMonth = new Map<string, DailyReportRow[]>();
  dailyRows.forEach((r) => {
    const key = monthKeyOf(r.date);
    const list = byMonth.get(key) ?? [];
    list.push(r);
    byMonth.set(key, list);
  });

  return enumerateMonthKeys(fromMonth, toMonth).map((month) => {
    const rows = byMonth.get(month) ?? [];
    const t = summarizeAdFunnelRows(rows);
    return {
      month,
      pvCount: t.pv,
      impCount: t.imp,
      impRate: t.impRate,
      clCount: t.cl,
      clRate: t.clRate,
      friendCount: t.friend,
      friendAddRate: t.friendAddRate,
      cvCount: t.cv,
      cvr: t.cvr,
      billingAmount: t.billing,
    };
  });
}

export type PopupMonthlyReportRow = {
  month: string; // YYYY-MM
  popup: string;
  pvCount: number | null;
  impCount: number | null;
  clCount: number | null;
  clRate: number | null;
  friendCount: number;
  friendAddRate: number | null;
  cvCount: number;
  cvr: number | null;
  billingAmount: number; // 請求額(円)
};

// ポップアップ別月次レポート。buildPopupDailyReportが作る「ポップアップ×日付」ごとの行を、
// ポップアップごとに月単位で合算する。
export function buildPopupMonthlyReport(
  dailyRows: PopupDailyReportRow[],
  fromMonth: string,
  toMonth: string
): PopupMonthlyReportRow[] {
  const popupOrder = Array.from(new Set(dailyRows.map((r) => r.popup)));
  const byKey = new Map<string, PopupDailyReportRow[]>();
  dailyRows.forEach((r) => {
    const key = `${r.popup}__${monthKeyOf(r.date)}`;
    const list = byKey.get(key) ?? [];
    list.push(r);
    byKey.set(key, list);
  });

  const months = enumerateMonthKeys(fromMonth, toMonth);
  const rows: PopupMonthlyReportRow[] = [];
  popupOrder.forEach((popup) => {
    months.forEach((month) => {
      const subset = byKey.get(`${popup}__${month}`) ?? [];
      const t = summarizeAdFunnelRows(subset);
      rows.push({
        month,
        popup,
        pvCount: t.pv,
        impCount: t.imp,
        clCount: t.cl,
        clRate: t.clRate,
        friendCount: t.friend,
        friendAddRate: t.friendAddRate,
        cvCount: t.cv,
        cvr: t.cvr,
        billingAmount: t.billing,
      });
    });
  });
  return rows;
}

export type ComboMonthlyReportRow = {
  month: string; // YYYY-MM
  label: string;
  friendCount: number;
  cvCount: number;
  cvr: number | null;
};

// 「ポップアップ×シナリオ別」「設置先×訴求×離脱地点×ポップアップ×シナリオ×中間別」月次レポート用の
// 共通集計ロジック。この2つの組み合わせ軸はPV数・imp数・CL数の取り込みが無いため、
// 友だち追加数・CV数・CVRのみを、クリックログ・成果ログの流入経路(sourceId)を流入経路管理の設定と
// 突き合わせて月単位で集計する。
export function buildComboMonthlyReport(
  fromMonth: string,
  toMonth: string,
  friends: FriendDoc[],
  cvEntries: EffectiveCvEntry[],
  labelMap: Map<string, string>
): ComboMonthlyReportRow[] {
  const labelOf = (sourceId: string | undefined): string =>
    sourceId ? labelMap.get(sourceId) ?? "(未設定)" : "(未設定)";

  const labels = new Set<string>();
  const friendCountByKey = new Map<string, number>(); // key: `${label}__${month}`
  friends.forEach((f) => {
    const label = labelOf(f.sourceId);
    labels.add(label);
    const key = `${label}__${monthKeyOf(dateKeyJST(f.addedAt))}`;
    friendCountByKey.set(key, (friendCountByKey.get(key) ?? 0) + 1);
  });

  const cvCountByKey = new Map<string, number>();
  cvEntries
    .filter((c) => !c.hidden)
    .forEach((c) => {
      // 成果時点で最新だった流入経路(latestSourceId)を優先し、再クリックが無い場合はsourceIdにフォールバックする。
      // "import"(CSV等で手動追加した成果)は流入経路を持たないため「(インポート)」としてまとめる。
      const label = c.kind === "auto" ? labelOf(c.latestSourceId ?? c.sourceId) : "(インポート)";
      labels.add(label);
      const key = `${label}__${monthKeyOf(dateKeyJST(c.convertedAt))}`;
      cvCountByKey.set(key, (cvCountByKey.get(key) ?? 0) + 1);
    });

  const sortedLabels = Array.from(labels).sort((a, b) => {
    const isSpecialA = a.startsWith("(");
    const isSpecialB = b.startsWith("(");
    if (isSpecialA !== isSpecialB) return isSpecialA ? 1 : -1;
    return a.localeCompare(b, "ja");
  });

  const months = enumerateMonthKeys(fromMonth, toMonth);
  const rows: ComboMonthlyReportRow[] = [];
  sortedLabels.forEach((label) => {
    months.forEach((month) => {
      const friendCount = friendCountByKey.get(`${label}__${month}`) ?? 0;
      const cvCount = cvCountByKey.get(`${label}__${month}`) ?? 0;
      rows.push({
        month,
        label,
        friendCount,
        cvCount,
        cvr: friendCount > 0 ? Math.round((cvCount / friendCount) * 1000) / 10 : null,
      });
    });
  });
  return rows;
}
