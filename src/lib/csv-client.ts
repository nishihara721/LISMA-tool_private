// ブラウザ側(管理画面のCSVインポート機能)で使う軽量なパーサーと日付ユーティリティ。
// 取り込めるのはCSVのみ(Excelファイルは、CSVとして保存し直してから取り込む)。
// 社内利用の小規模なファイルを想定しているため、ライブラリを使わず自前で最低限のものを用意している。

// ファイル選択(<input type="file">)のaccept属性にそのまま指定する値
export const CSV_ACCEPT = ".csv,text/csv";

// ダブルクォート囲み・カンマ区切りに対応した簡易CSVパーサー
export function parseCsv(text: string): string[][] {
  text = text.replace(/^\uFEFF/, ""); // 先頭のBOM(文字コードの印)は取り除く
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      pushField();
    } else if (ch === "\n") {
      pushRow();
    } else if (ch === "\r") {
      // \r\n の \r は読み飛ばす。\r だけで改行しているファイル(古いMac形式)は、行の区切りとして扱う
      if (text[i + 1] !== "\n") pushRow();
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) pushRow();
  // 空行(末尾の改行等)を除く
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

export function todayJST(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
}
export function daysAgoJST(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(d);
}

// 月次レポート用。日本時間での「今月」を "YYYY-MM" 形式で返す。
export function currentMonthJST(): string {
  return todayJST().slice(0, 7);
}
// 日本時間で「monthsAgoヶ月前の月」を "YYYY-MM" 形式で返す(月次レポートの期間指定の既定値などに使う)。
export function monthsAgoJST(months: number): string {
  const d = new Date(`${todayJST()}T00:00:00+09:00`);
  d.setDate(1); // 月末日からの引き算で月がずれないよう、先に1日に固定する
  d.setMonth(d.getMonth() - months);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(d).slice(0, 7);
}

// 日付の文字列を { year, month, day } に読み取る共通処理。次の形式を受け付ける(日時付きの場合、時刻は呼び出し側が別に処理する)。
//  ・"2026/10/19"・"2026-10-19"・"2026/1/9"(月日は1桁でもよい)・"2026年10月19日"
//  ・年が無い日付("10/19"など)は読み取らない(年が分からないため。呼び出し側で読み取れない行として扱う)
function readDateParts(text: string): { year: string; month: string; day: string; rest: string } | null {
  const t = text.trim();
  const pad = (n: string) => n.padStart(2, "0");
  const valid = (m: string, d: string) => Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31;
  const m = t.match(/^(\d{4})(?:[/\-.]|年)(\d{1,2})(?:[/\-.]|月)(\d{1,2})日?(.*)$/);
  if (m) {
    if (!valid(m[2], m[3])) return null;
    return { year: m[1], month: pad(m[2]), day: pad(m[3]), rest: m[4] };
  }
  return null;
}

// 日付単独・日時付き("HH:mm"付き)のいずれでも受け付け、日本時間として解釈してミリ秒に変換する
export function parseJstDateTime(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const parts = readDateParts(trimmed);
  if (!parts) return null;
  const timeMatch = parts.rest.match(/^[ T]+(\d{1,2}):(\d{2})$/);
  if (parts.rest.trim() !== "" && !timeMatch) return null;
  const time = timeMatch ? `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}` : "00:00";
  const ms = new Date(`${parts.year}-${parts.month}-${parts.day}T${time}:00+09:00`).getTime();
  return Number.isNaN(ms) ? null : ms;
}

// 日付を "YYYY-MM-DD" の日付キーに正規化する(日時部分・時刻は無視)
export function parseJstDateKey(text: string): string | null {
  const parts = readDateParts(text);
  if (!parts) return null;
  const key = `${parts.year}-${parts.month}-${parts.day}`;
  return Number.isNaN(Date.parse(`${key}T00:00:00+09:00`)) ? null : key;
}

// CSVの数値セルを数値に変換する("1,234"のような3桁区切り・全角数字・前後の空白を許容)。数値でなければNaN。
export function parseCsvNumber(text: string): number {
  const t = text.normalize("NFKC").replace(/[,\s]/g, "");
  return t === "" ? NaN : Number(t);
}

// CSVファイルの文字コードを判定してテキストに変換する。
// 多くのツール(Flipdesk等)はUTF-8でエクスポートするが、Lステップ等、Shift_JIS(CP932)でエクスポートする
// ツールもある。UTF-8として正しく解釈できない場合(fatal:trueで例外になった場合)はShift_JISとして
// 読み直すことで、エクスポート元によらず文字化けなく読み込めるようにする。
async function readCsvText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("shift-jis").decode(buffer);
  }
}

// CSVファイルを読み込み、「文字列の二次元配列」の形で返す。以降のインポート処理(列名の検出・集計等)は共通のロジックで扱う。
// Excelファイル(.xlsx/.xls)は読み込めないため、エラーにして、CSVで保存し直すよう案内する。
export async function parseCsvFile(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    throw new Error("Excelファイルは取り込めません。Excelで「CSV UTF-8(コンマ区切り)」として保存し直してから、CSVファイルを選んでください");
  }
  const text = await readCsvText(file);
  return parseCsv(text);
}
