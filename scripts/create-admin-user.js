// 管理画面ログインの最初のアカウント(管理者権限)を作成するスクリプト。
//
// 画面からユーザーを作成するには、すでに管理者権限でログインできている必要があるため、
// 最初の1人目だけはこのスクリプトで直接Firestoreに登録する(それ以降は /admin/users 画面から作成・編集できる)。
//
// 使い方(プロジェクトのルートディレクトリで実行):
//   node scripts/create-admin-user.js <ログインID> <パスワード> [表示名]
//
// 例:
//   node scripts/create-admin-user.js chihiro "すごく長くて複雑なパスワード" 西原ちひろ
//
// すでに同じログインIDが存在する場合は、パスワード・表示名を上書きする(role は常に管理者権限にする)。

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

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

// src/lib/password.ts の hashPassword() と同じロジック(このスクリプトはNode.jsから直接実行するため、
// TypeScriptのsrc/lib/password.tsをそのまま読み込めず、同じ処理をここに複製している)。
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function nanoid8() {
  return crypto.randomBytes(6).toString("hex").slice(0, 8);
}

async function main() {
  const [loginId, password, displayNameArg] = process.argv.slice(2);
  if (!loginId || !password) {
    console.error("使い方: node scripts/create-admin-user.js <ログインID> <パスワード> [表示名]");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("パスワードは8文字以上にしてください");
    process.exit(1);
  }
  const displayName = displayNameArg || loginId;

  const existing = await db.collection("admin_users").where("loginId", "==", loginId).limit(1).get();
  const now = Date.now();

  if (!existing.empty) {
    const doc = existing.docs[0];
    await doc.ref.update({
      passwordHash: hashPassword(password),
      displayName,
      role: "admin",
      updatedAt: now,
    });
    console.log(`既存のユーザー「${loginId}」を管理者権限で更新しました(userId: ${doc.id})`);
    return;
  }

  const userId = nanoid8();
  await db.collection("admin_users").doc(userId).set({
    userId,
    loginId,
    passwordHash: hashPassword(password),
    displayName,
    role: "admin",
    createdAt: now,
    updatedAt: now,
  });
  console.log(`管理者権限のユーザー「${loginId}」を作成しました(userId: ${userId})`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
