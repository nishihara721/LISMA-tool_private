// ブラウザ側(管理画面のCSV/Excelインポート機能)で使う軽量なパーサーと日付ユーティリティ。
// 社内利用の小規模なファイルを想定しているため、CSVはライブラリを使わず自前で最低限のものを用意している。
// Excel(.xlsx/.xls)の読み込みだけは xlsx(SheetJS)ライブラリを使う。

// ファイル選択(<input type="file">)のaccept属性にそのまま指定する値
export const SPREADSHEET_ACCEPT =
  ".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel";

// ダブルクォート囲み・カンマ区切りに対応した簡易CSVパーサー
export function parseCsv(text: string): string[][] {
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
      // 無視(\r\nの\rは読み飛ばす)
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

// "YYYY/MM/DD"・"YYYY-MM-DD" どちらの区切りでも、日付単独・日時付き("HH:mm"付き)の
// いずれでも受け付け、日本時間として解釈してミリ秒に変換する
export function parseJstDateTime(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{4})[/-](\d{2})[/-](\d{2})(?:[ T](\d{2}:\d{2}))?$/);
  if (!match) return null;
  const [, year, month, day, time] = match;
  const ms = new Date(`${year}-${month}-${day}T${time ?? "00:00"}:00+09:00`).getTime();
  return Number.isNaN(ms) ? null : ms;
}

// "YYYY/MM/DD"・"YYYY-MM-DD" を "YYYY-MM-DD" の日付キーに正規化する(日時部分・時刻は無視)
export function parseJstDateKey(text: string): string | null {
  const trimmed = text.trim();
  const match = trimmed.match(/^(\d{4})[/-](\d{2})[/-](\d{2})/);
  if (!match) return null;
  const [, year, month, day] = match;
  return `${year}-${month}-${day}`;
}

// Excelのシリアル日付・JSのDateオブジェクトを "YYYY/MM/DD" または "YYYY/MM/DD HH:mm" の文字列に変換する。
// SheetJSは cellDates:true で読み込むと、そのセルに入力されている「見た目通りの日時」をUTC基準のDateとして
// 返すため、タイムゾーンによるズレを防ぐためにUTCのgetterで値を取り出す。
function formatExcelDateCell(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = d.getUTCHours();
  const mm = d.getUTCMinutes();
  const datePart = `${y}/${m}/${day}`;
  return hh || mm ? `${datePart} ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}` : datePart;
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

// CSV(.csv)またはExcel(.xlsx/.xls)ファイルを読み込み、どちらも同じ「文字列の二次元配列」の形で返す。
// これにより、以降のインポート処理(列名の検出・集計等)はファイル形式を意識せず共通のロジックで扱える。
//
// Excelファイルの読み込みには xlsx(SheetJS)ライブラリを使う。ファイルサイズが大きくなりがちなため、
// CSVファイルが選択された場合は読み込まない(動的importにして、必要な場合だけバンドルを読み込む)。
export async function parseSpreadsheetFile(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const XLSX = await import("xlsx");
    const buffer = await file.arrayBuffer();
    // cellDates:true だと、SheetJSがブラウザのタイムゾーン(日本は歴史的な+9:18:59の補正が入る)で
    // Dateに変換するため、日付が1日前にずれることがある。そこで日付はシリアル値のまま読み込み、
    // 表示形式が日付のセルだけ、SheetJSの日付コード解析(タイムゾーンに依存しない)で年月日・時分に直す。
    const workbook = XLSX.read(buffer, { type: "array", cellNF: true });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) return [];
    const sheet = workbook.Sheets[firstSheetName];
    if (!sheet || !sheet["!ref"]) return [];
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    const rows: string[][] = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row: string[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        if (!cell || cell.v === undefined || cell.v === null) {
          row.push("");
        } else if (cell.t === "n" && typeof cell.v === "number" && cell.z && XLSX.SSF.is_date(String(cell.z))) {
          const dc = XLSX.SSF.parse_date_code(cell.v);
          if (dc) {
            const datePart = `${dc.y}/${String(dc.m).padStart(2, "0")}/${String(dc.d).padStart(2, "0")}`;
            row.push(dc.H || dc.M ? `${datePart} ${String(dc.H).padStart(2, "0")}:${String(dc.M).padStart(2, "0")}` : datePart);
          } else {
            row.push(String(cell.v));
          }
        } else if (cell.v instanceof Date) {
          row.push(formatExcelDateCell(cell.v));
        } else {
          row.push(String(cell.v));
        }
      }
      rows.push(row);
    }
    return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
  }

  // それ以外(.csv、または拡張子なし)はCSVとして扱う
  const text = await readCsvText(file);
  return parseCsv(text);
}
