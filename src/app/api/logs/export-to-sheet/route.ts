import { NextRequest, NextResponse } from "next/server";

// クリックログ・成果ログ画面の「スプレッドシートに送信」ボタンから呼ばれる。
//
// Googleスプレッドシートへの書き込みには認証が必要になるため、このAPI自体はFirestore等に
// 直接書き込むのではなく、あらかじめ用意した「Google Apps Script(GAS)のWebアプリ」に
// データを転送するだけの役割を持つ(LSTEP_WEBHOOK_URLへの転送と同じ考え方)。
//
// GAS側の実装例はdocs/setup.mdの「スプレッドシートへの出力」を参照。
const sheetsWebhookUrl = process.env.SHEETS_EXPORT_WEBHOOK_URL;

const WRITE_MODES = new Set(["append", "overwrite", "cell"]);

// 「https://docs.google.com/spreadsheets/d/xxxxx/edit#gid=0」のようなURLが貼られた場合に
// スプレッドシートIDだけを取り出す。URLでなく素のIDがそのまま入力された場合はそのまま使う。
function extractSpreadsheetId(input: string): string {
  const match = input.match(/\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : input;
}

export async function POST(req: NextRequest) {
  if (!sheetsWebhookUrl) {
    return NextResponse.json(
      {
        error:
          "SHEETS_EXPORT_WEBHOOK_URL が .env.local に設定されていません。docs/setup.mdの「スプレッドシートへの出力」の手順に沿ってGoogle Apps ScriptのWebアプリURLを設定してください。",
      },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.rows) || !Array.isArray(body.headers) || !body.logType) {
    return NextResponse.json({ error: "リクエスト内容が不正です" }, { status: 400 });
  }

  // 送信先(スプレッドシート・シート名)と書き込み方法の指定はすべて任意。
  // 指定が無ければGAS側のデフォルト動作(バインド先のスプレッドシートの、logTypeという名前のシートに追記)にフォールバックする。
  const writeMode = typeof body.writeMode === "string" && WRITE_MODES.has(body.writeMode) ? body.writeMode : "append";

  if (writeMode === "cell") {
    const startCell = typeof body.startCell === "string" ? body.startCell.trim() : "";
    if (!/^[A-Za-z]+[1-9][0-9]*$/.test(startCell)) {
      return NextResponse.json({ error: "開始セルの指定が不正です(例: A1, B3)" }, { status: 400 });
    }
  }

  const payload = {
    logType: body.logType,
    headers: body.headers,
    rows: body.rows,
    spreadsheetId:
      typeof body.spreadsheet === "string" && body.spreadsheet.trim()
        ? extractSpreadsheetId(body.spreadsheet.trim())
        : undefined,
    sheetName: typeof body.sheetName === "string" && body.sheetName.trim() ? body.sheetName.trim() : undefined,
    writeMode,
    startCell: writeMode === "cell" ? String(body.startCell).trim() : undefined,
  };

  try {
    const res = await fetch(sheetsWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `スプレッドシート側でエラーが発生しました(${res.status}) ${text}`.trim() },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("スプレッドシートへの送信エラー:", e);
    return NextResponse.json({ error: "スプレッドシートへの送信に失敗しました(通信エラー)" }, { status: 502 });
  }
}
