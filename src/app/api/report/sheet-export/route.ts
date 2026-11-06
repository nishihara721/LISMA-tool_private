import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/require-admin";
import { buildSheetExportReports } from "@/lib/sheet-report-export";

export const dynamic = "force-dynamic";

// 「データ」メニューの「レポートのスプレッドシート送信」画面(/admin/reports/sheet-export)から呼ばれる。
//
// 日次・ポップアップ別・シナリオ別・訴求別・離脱地点別の5つのレポートを指定した期間について計算し、
// 5つのシートへ送信する(/api/report/:path* はproxy.tsでログイン必須の対象になっている)。
// 既存のログ送信(/api/logs/export-to-sheet)と同じGAS Webアプリ(SHEETS_EXPORT_WEBHOOK_URL)に対して、
// 5つのシートへ順番に(並列ではなく)送信する。書き込み方法は新しい「蓄積モード」(writeMode: "merge")で、
// 日付をキーに既存行を更新・新しい日付は追加し、過去のデータを消さずに積み重ねていく。
// GAS側の実装はdocs/setup.mdの「レポートの一括スプレッドシート送信」を参照。
const sheetsWebhookUrl = process.env.SHEETS_EXPORT_WEBHOOK_URL;

export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "権限がありません" }, { status: 403 });

  if (!sheetsWebhookUrl) {
    return NextResponse.json(
      {
        error:
          "SHEETS_EXPORT_WEBHOOK_URL が .env.local に設定されていません。docs/setup.mdの「ログ画面のCSVダウンロード・スプレッドシートへの出力」の手順に沿ってGoogle Apps ScriptのWebアプリURLを設定してください。",
      },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => null);
  const from = typeof body?.from === "string" ? body.from : null;
  const to = typeof body?.to === "string" ? body.to : null;
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    return NextResponse.json({ error: "日付の指定が不正です" }, { status: 400 });
  }

  const spreadsheetId =
    typeof body?.spreadsheet === "string" && body.spreadsheet.trim()
      ? extractSpreadsheetId(body.spreadsheet.trim())
      : undefined;

  let reports;
  try {
    reports = await buildSheetExportReports(from, to);
  } catch (e) {
    console.error("レポート計算エラー:", e);
    return NextResponse.json({ error: "レポートの計算に失敗しました" }, { status: 500 });
  }

  // スプレッドシート側の書き込み競合を避けるため、5シートへは並列ではなく順番に送信する
  const results: { sheetName: string; ok: boolean; error?: string }[] = [];
  for (const report of reports) {
    const payload = {
      writeMode: "merge",
      spreadsheetId,
      sheetName: report.sheetName,
      metricHeaders: report.metricHeaders,
      groups: report.grouped ? report.groups : undefined,
      rows: report.rows,
    };
    try {
      const res = await fetch(sheetsWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        results.push({ sheetName: report.sheetName, ok: false, error: `(${res.status}) ${text}`.trim() });
        continue;
      }
      // GAS Webアプリの「アクセスできるユーザー」設定が「全員」になっていない場合、
      // 未ログイン状態のリクエストはGoogleのログイン画面(HTML、HTTP 200)にリダイレクトされる。
      // この場合doPostは実行されず、何も書き込まれないにもかかわらずHTTP自体は失敗しないため、
      // 「JSONとして解析できた上でok:trueだったか」まで厳密に確認する(そうでなければ失敗扱いにする)。
      const result: unknown = await res.json().catch(() => null);
      const isOk = typeof result === "object" && result !== null && (result as { ok?: unknown }).ok === true;
      if (!isOk) {
        const errMessage =
          result && typeof result === "object" && "error" in result
            ? String((result as { error?: unknown }).error)
            : "GASからの応答が不正です(JSONとして解析できませんでした)。GAS Webアプリのデプロイで「アクセスできるユーザー」が「全員」になっているか確認してください。";
        results.push({ sheetName: report.sheetName, ok: false, error: errMessage });
        continue;
      }
      results.push({ sheetName: report.sheetName, ok: true });
    } catch (e) {
      console.error(`スプレッドシートへの送信エラー(${report.sheetName}):`, e);
      results.push({ sheetName: report.sheetName, ok: false, error: "通信エラー" });
    }
  }

  const allOk = results.every((r) => r.ok);
  return NextResponse.json({ ok: allOk, results });
}

// 「https://docs.google.com/spreadsheets/d/xxxxx/edit#gid=0」のようなURLが貼られた場合に
// スプレッドシートIDだけを取り出す(既存のexport-to-sheetルートと同じ考え方)。
function extractSpreadsheetId(input: string): string {
  const match = input.match(/\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : input;
}
