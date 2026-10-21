// 友だちデータ・各種ログ・レポートの取り込みデータをまとめて削除するスクリプト。
// テスト・確認用に投入したデータを一掃して、画面をまっさらな状態に戻すためのもの(本番環境への反映機能ではない)。
//
// 削除対象(標準):
//   - friends                    … 友だち一覧
//   - clicks                     … クリックログ(流入経路ログ・広告ログの両方。linkTypeで出し分けている)
//   - conversions                … 成果ログ(自動計測分)
//   - report_cv_entries          … 編集用成果ログ画面での手動追加・非表示設定(成果ログの上書き情報)
//   - event_logs                 … エラー・システムログ
//   - daily_ad_metrics           … 日次レポートのimp数・CL数・PV数
//   - daily_popup_ad_metrics     … ポップアップ別日次レポートのimp数・CL数・PV数
//   - daily_scenario_ad_metrics  … シナリオ別日次レポートのimp数・CL数・PV数
//   - daily_exit_point_ad_metrics… 離脱地点別日次レポートのimp数・CL数・PV数
//   - daily_appeal_ad_metrics    … 訴求別日次レポートのimp数・CL数・PV数
//   - daily_source_ad_metrics    … 流入経路の名前別(月次サマリ)のimp数・CL数
//   - daily_popup_scenario_ad_metrics … ポップアップ×シナリオ別(月次サマリ)のimp数・CL数
//
// --all を付けた場合のみ、さらに次も削除する(テスト環境を完全に初期化したいとき用):
//   - sources         … 流入経路管理に登録した一覧
//   - purchase_links  … 広告管理に登録した一覧(成果単価も含む)
//   - counters        … 友だちIDの連番カウンタ(削除すると連番が1から振り直される)
//
// どちらの場合も削除しないもの:
//   - admin_users … 管理画面のログインアカウント(消すとログインできなくなるため)
//
// 使い方(プロジェクトのルートディレクトリで実行):
//   node scripts/delete-all-logs.js         … 削除せず、各コレクションの件数だけ確認する(安全確認用)
//   node scripts/delete-all-logs.js --yes   … 実際に削除する(元に戻せません)
//   node scripts/delete-all-logs.js --all --yes … 流入経路・広告・カウンタも含めてすべて削除する(admin_usersのみ残す)
//   node scripts/delete-all-logs.js --logs-only --yes … ログ(クリック・成果・編集用成果ログ・エラー/システムログ)だけを削除する。
//                                                      友だち一覧・レポートの取り込みデータ・流入経路・広告は残す
//
// --yes を付けると、実行前に「対象のFirebaseプロジェクトID」の入力を求める(接続先を間違えて本番を消さないための確認)。
//
// 本番のFirebaseプロジェクトに接続している場合、--yes を付けると本番データが完全に削除されます。
// 事前に .env.local の FB_PROJECT_ID が意図したプロジェクトを指しているか必ず確認してください。

const fs = require("fs");
const path = require("path");

function loadEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) {
    console.error(".env.local が見つかりません。プロジェクトのルートディレクトリで実行してください。");
    process.exit(1);
  }
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvLocal();

const admin = require("firebase-admin");

function getAdminApp() {
  if (admin.apps.length > 0) return admin.apps[0];
  const projectId = process.env.FB_PROJECT_ID;
  const clientEmail = process.env.FB_CLIENT_EMAIL;
  const privateKey = process.env.FB_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) {
    console.error("Firebase Admin の環境変数(FB_PROJECT_ID / FB_CLIENT_EMAIL / FB_PRIVATE_KEY)が.env.localに設定されていません");
    process.exit(1);
  }
  return admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }) });
}

const db = admin.firestore(getAdminApp());
db.settings({ ignoreUndefinedProperties: true });

const TARGET_COLLECTIONS = [
  "friends",
  "clicks",
  "conversions",
  "report_cv_entries",
  "event_logs",
  "daily_ad_metrics",
  "daily_popup_ad_metrics",
  "daily_scenario_ad_metrics",
  "daily_exit_point_ad_metrics",
  "daily_appeal_ad_metrics",
  "daily_source_ad_metrics",
  "daily_popup_scenario_ad_metrics",
  "daily_stats",
  "daily_stats_meta",
];
// --all のときだけ追加で削除するコレクション
const MASTER_COLLECTIONS = ["sources", "purchase_links", "counters"];
// --logs-only のときの削除対象(各ログ画面に表示されるデータ)
// (日ごとの集計 daily_stats は友だち・成果から作る派生データのため、ログを消す場合も一緒に消す。削除後、次に友だち追加・成果が記録されたときに自動で集計が再開される)
const LOG_COLLECTIONS = ["clicks", "conversions", "report_cv_entries", "event_logs", "daily_stats", "daily_stats_meta"];
const BATCH_SIZE = 500;

async function countDocs(collectionName) {
  const snap = await db.collection(collectionName).count().get();
  return snap.data().count;
}

// 件数に関わらず、500件ずつバッチ削除を繰り返してコレクションを空にする
async function deleteCollection(collectionName) {
  let deleted = 0;
  for (;;) {
    const snap = await db.collection(collectionName).limit(BATCH_SIZE).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += snap.size;
  }
  return deleted;
}

async function main() {
  const dryRun = !process.argv.includes("--yes");
  const includeAll = process.argv.includes("--all");
  const logsOnly = process.argv.includes("--logs-only");
  if (includeAll && logsOnly) {
    console.error("--all と --logs-only は同時に指定できません");
    process.exit(1);
  }
  const targets = logsOnly ? LOG_COLLECTIONS : includeAll ? [...TARGET_COLLECTIONS, ...MASTER_COLLECTIONS] : TARGET_COLLECTIONS;
  const projectId = process.env.FB_PROJECT_ID;

  console.log(`対象のFirebaseプロジェクト: ${projectId}`);
  console.log(dryRun ? "(確認のみ。削除は行いません。削除するには --yes を付けて実行してください)" : "削除を実行します...");
  console.log("");

  if (!dryRun) {
    // 接続先を間違えて本番のデータを消してしまわないよう、プロジェクトIDの入力を求める
    const readline = require("readline").createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((resolve) =>
      readline.question(`削除してよい場合は、対象のFirebaseプロジェクトID「${projectId}」を入力してください: `, resolve)
    );
    readline.close();
    if (String(answer).trim() !== projectId) {
      console.log("入力が一致しないため、中止しました。何も削除していません。");
      return;
    }
    console.log("");
  }

  for (const name of targets) {
    const count = await countDocs(name);
    console.log(`- ${name}: ${count}件`);
    if (!dryRun && count > 0) {
      const deleted = await deleteCollection(name);
      console.log(`  → ${deleted}件削除しました`);
    }
  }

  console.log("");
  console.log(dryRun
      ? "確認が終わりました。削除するには `node scripts/delete-all-logs.js " + (includeAll ? "--all " : logsOnly ? "--logs-only " : "") + "--yes` を実行してください。"
      : "削除が完了しました。");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
