// ID(idNumber)が未設定の友だちに、追加日時が古い順で連番を付与するスクリプト。
// Webhook経由ではなくデータを直接投入した場合(テストデータなど)に、友だち一覧の「ID」を後から埋めるために使う。
// すでにidNumberを持つ友だちは変更せず、counters/friendIdNumber と既存の最大値の続きから採番する。
//
// 使い方(プロジェクトのルートで):
//   node scripts/assign-friend-ids.js          # 付与する件数だけ表示(書き込まない)
//   node scripts/assign-friend-ids.js --yes    # 実際に付与する
const fs = require("fs");
const path = require("path");

function loadEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) {
    console.error(".env.local が見つかりません。プロジェクトのルートディレクトリで実行してください。");
    process.exit(1);
  }
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let value = t.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function main() {
  loadEnvLocal();
  const admin = require("firebase-admin");
  const privateKey = process.env.FB_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!process.env.FB_PROJECT_ID || !process.env.FB_CLIENT_EMAIL || !privateKey) {
    console.error("Firebase Admin の環境変数が.env.localに設定されていません");
    process.exit(1);
  }
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FB_PROJECT_ID,
      clientEmail: process.env.FB_CLIENT_EMAIL,
      privateKey,
    }),
  });
  const db = admin.firestore();

  const [friendsSnap, counterSnap] = await Promise.all([
    db.collection("friends").get(),
    db.collection("counters").doc("friendIdNumber").get(),
  ]);
  const friends = friendsSnap.docs.map((d) => ({ ref: d.ref, ...d.data() }));
  const maxExisting = friends.reduce((m, f) => Math.max(m, f.idNumber ?? 0), 0);
  let next = Math.max(counterSnap.data()?.value ?? 0, maxExisting) + 1;
  const targets = friends.filter((f) => !f.idNumber).sort((a, b) => (a.addedAt ?? 0) - (b.addedAt ?? 0));
  console.log(`対象プロジェクト: ${process.env.FB_PROJECT_ID}`);
  console.log(`友だち ${friends.length}件のうち、ID未設定は ${targets.length}件です(${next}番から採番)`);
  if (targets.length === 0) return;
  if (!process.argv.includes("--yes")) {
    console.log("書き込むには --yes を付けて実行してください。");
    return;
  }
  for (let i = 0; i < targets.length; i += 400) {
    const batch = db.batch();
    for (const f of targets.slice(i, i + 400)) batch.update(f.ref, { idNumber: next++ });
    await batch.commit();
  }
  await db.collection("counters").doc("friendIdNumber").set({ value: next - 1 }, { merge: true });
  console.log(`${targets.length}件に付与しました(最終番号: ${next - 1})`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
