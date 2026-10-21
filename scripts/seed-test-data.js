// テスト用データの投入スクリプト。
//
// 「友だち一覧」「流入経路ログ(クリックログ)」「広告ログ(クリックログ・成果ログ)」の画面確認用に、
// すでに /admin/sources・/admin/purchase-links に登録済みの流入経路・購入リンクを使って、
// ファネル風の比率(流入経路クリック → 友だち追加 → 購入リンククリック → CV)でテストデータをまとめて投入する。
//
// 使い方(プロジェクトのルートディレクトリで実行):
//   node scripts/seed-test-data.js            … 100件(既定)投入する
//   node scripts/seed-test-data.js 50         … 件数を指定して投入する(例: 50件)
//   node scripts/seed-test-data.js --undo     … このスクリプトで投入したテストデータをすべて削除する
//
// 期間を指定して、1日ごとの件数を決めて投入することもできる:
//   node scripts/seed-test-data.js --from 2026-10-01 --to 2026-10-09
//       … 2026/10/1〜10/9(日本時間)の1日ごとに、友だち追加15〜25人・CV 5〜10件を投入する
//   node scripts/seed-test-data.js --from 2026-10-01 --to 2026-10-09 --friends-per-day 10-30 --cv-per-day 3-8
//       … 1日あたりの友だち追加数・CV数の範囲を変える(例: 友だち10〜30人・CV 3〜8件)
//   node scripts/seed-test-data.js --from 2026-10-01 --to 2026-10-09 --dry-run
//       … 何も書き込まず、日ごとの件数だけを表示する
// 期間指定の投入は、書き込む前に対象のFirebaseプロジェクトIDの入力を求める(接続先の確認)。
// 現在時刻より未来の時刻のデータは作らない(期間に今日が含まれる場合、今日は現在時刻までの分だけ作る)。
//
// 投入されるのは以下の3コレクション:
//   - friends      … テスト用の友だち(userIdは "test_" から始まる、実際のLINEユーザーとは無関係のID)
//   - clicks       … 流入経路リンクのクリックログ(linkType: "add_friend")・購入リンクのクリックログ(linkType: "purchase")
//   - conversions  … CV(購入成果)ログ
//
// テストデータには全件 "test_" プレフィックスの userId/clickId/conversionId が付くため、
// --undo で安全に(本物のデータを巻き込まず)削除できる。

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// .env.local を読み込み、Next.jsアプリと同じ環境変数(FB_PROJECT_ID等)を使えるようにする。
// (このスクリプトはNext.jsの外から直接Node.jsで実行するため、dotenv等に頼らず簡易パーサーで読み込む)
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

// Firestoreへの接続は、実際に書き込む・削除するときまで行わない(--dry-runや件数の計算だけなら、接続情報が無くても動く)
let _db = null;
function getDb() {
  if (_db) return _db;
  loadEnvLocal();
  const admin = require("firebase-admin");
  if (admin.apps.length === 0) {
    const projectId = process.env.FB_PROJECT_ID;
    const clientEmail = process.env.FB_CLIENT_EMAIL;
    const privateKey = process.env.FB_PRIVATE_KEY?.replace(/\\n/g, "\n");
    if (!projectId || !clientEmail || !privateKey) {
      console.error("Firebase Admin の環境変数(FB_PROJECT_ID / FB_CLIENT_EMAIL / FB_PRIVATE_KEY)が.env.localに設定されていません");
      process.exit(1);
    }
    admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }) });
  }
  _db = admin.firestore();
  _db.settings({ ignoreUndefinedProperties: true });
  return _db;
}

const TEST_PREFIX = "test_";

function randomId() {
  return TEST_PREFIX + crypto.randomBytes(6).toString("hex");
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// 直近30日間のどこかのランダムな時刻(ミリ秒)を返す
function randomTimeWithinDays(daysAgo) {
  const now = Date.now();
  const from = now - daysAgo * 24 * 60 * 60 * 1000;
  return randomInt(from, now);
}

async function seed(count) {
  const [sourcesSnap, purchaseLinksSnap] = await Promise.all([
    getDb().collection("sources").get(),
    getDb().collection("purchase_links").get(),
  ]);
  const sources = sourcesSnap.docs.map((d) => d.data());
  const purchaseLinks = purchaseLinksSnap.docs.map((d) => d.data());

  if (sources.length === 0) {
    console.error("流入経路(sources)が1件も登録されていません。先に /admin/sources から登録してください。");
    process.exit(1);
  }
  if (purchaseLinks.length === 0) {
    console.error("購入リンク(purchase_links)が1件も登録されていません。先に /admin/purchase-links から登録してください。");
    process.exit(1);
  }

  console.log(`流入経路 ${sources.length}件・購入リンク ${purchaseLinks.length}件を使ってテストデータを作成します`);

  // ファネル比率(目安、countが100件の場合):
  //   流入経路クリック 約130件(友だち追加に至らなかった離脱分を含む) → 友だち追加100 → 購入リンククリック 約50件 → CV 約30件
  const SOURCE_CLICK_BOUNCE_RATE = 0.3; // 友だち追加に至らなかった(離脱した)流入経路クリックを、友だち数に対してこの割合だけ上乗せする
  const CLICK_RATE = 0.5;
  const CV_RATE_OF_CLICKS = 0.6;

  const batchesData = { friends: [], clicks: [], conversions: [] };

  for (let i = 0; i < count; i++) {
    const source = pick(sources);
    const userId = randomId();
    const addedAt = randomTimeWithinDays(30);
    const isUnfollowed = Math.random() < 0.08; // 約8%はブロック/解除済みとして状態列のテストに使う

    const friend = {
      userId,
      displayName: `テスト友だち${String(i + 1).padStart(3, "0")}`,
      sourceId: source.sourceId,
      latestSourceId: source.sourceId,
      addedAt,
    };
    if (isUnfollowed) {
      friend.unfollowedAt = addedAt + randomInt(1, 20) * 24 * 60 * 60 * 1000;
    }
    batchesData.friends.push(friend);

    // 友だち追加の直前に、その流入経路リンクをクリックしたログを必ず1件作る
    // (実際のフローでは、流入経路リンクのクリック→LIFFでの友だち追加、という順序になるため)
    batchesData.clicks.push({
      clickId: randomId(),
      linkType: "add_friend",
      sourceId: source.sourceId,
      userId,
      clickedAt: addedAt - randomInt(0, 10) * 60 * 1000,
      friendSourceIdAtClick: friend.sourceId,
      friendLatestSourceIdAtClick: friend.latestSourceId,
    });

    if (Math.random() < CLICK_RATE) {
      const purchaseLink = pick(purchaseLinks);
      const clickId = randomId();
      const clickedAt = addedAt + randomInt(0, 20) * 24 * 60 * 60 * 1000;
      batchesData.clicks.push({
        clickId,
        linkType: "purchase",
        sourceId: source.sourceId,
        userId,
        purchaseLinkId: purchaseLink.purchaseLinkId,
        clickedAt,
        friendSourceIdAtClick: friend.sourceId,
        friendLatestSourceIdAtClick: friend.latestSourceId,
      });

      if (Math.random() < CV_RATE_OF_CLICKS) {
        const convertedAt = clickedAt + randomInt(0, 3) * 24 * 60 * 60 * 1000;
        batchesData.conversions.push({
          conversionId: randomId(),
          userId,
          sourceId: friend.sourceId,
          latestSourceId: friend.latestSourceId,
          purchaseLinkId: purchaseLink.purchaseLinkId,
          clickId,
          amount: randomInt(1, 9) * 1000,
          convertedAt,
        });
      }
    }
  }

  // 友だち追加に至らなかった(離脱した)流入経路クリックを、友だち数に対してSOURCE_CLICK_BOUNCE_RATEの割合だけ追加する
  // (userIdなし=LIFFでのID取得前に離脱した、というクリックを想定)
  const bounceClickCount = Math.round(count * SOURCE_CLICK_BOUNCE_RATE);
  for (let i = 0; i < bounceClickCount; i++) {
    const source = pick(sources);
    batchesData.clicks.push({
      clickId: randomId(),
      linkType: "add_friend",
      sourceId: source.sourceId,
      clickedAt: randomTimeWithinDays(30),
    });
  }

  // Firestoreのbatchは1回あたり最大500件の書き込みまでのため、400件ずつに分けてコミットする
  // 友だち一覧の「ID」(idNumber)を、本番と同じ仕組み(counters/friendIdNumber)で採番する。
  // 追加日時が古い順に、現在のカウンタ値の続きから連番を振り、最後にカウンタも更新する。
  const counterRef = getDb().collection("counters").doc("friendIdNumber");
  const counterSnap = await counterRef.get();
  let nextId = (counterSnap.data()?.value ?? 0) + 1;
  [...batchesData.friends].sort((a, b) => a.addedAt - b.addedAt).forEach((f) => {
    f.idNumber = nextId++;
  });

  const allWrites = [
    ...batchesData.friends.map((doc) => ["friends", doc.userId, doc]),
    ...batchesData.clicks.map((doc) => ["clicks", doc.clickId, doc]),
    ...batchesData.conversions.map((doc) => ["conversions", doc.conversionId, doc]),
  ];

  for (let i = 0; i < allWrites.length; i += 400) {
    const batch = getDb().batch();
    for (const [collection, id, doc] of allWrites.slice(i, i + 400)) {
      batch.set(getDb().collection(collection).doc(id), doc);
    }
    await batch.commit();
  }

  await counterRef.set({ value: nextId - 1 }, { merge: true });
  await resetDailyStats();

  const addFriendClickCount = batchesData.clicks.filter((c) => c.linkType === "add_friend").length;
  const purchaseClickCount = batchesData.clicks.filter((c) => c.linkType === "purchase").length;

  console.log("完了しました:");
  console.log(`  friends:     ${batchesData.friends.length}件`);
  console.log(`  clicks:      ${batchesData.clicks.length}件(流入経路クリック ${addFriendClickCount}件 / 購入リンククリック ${purchaseClickCount}件)`);
  console.log(`  conversions: ${batchesData.conversions.length}件(CV)`);
  console.log("\n削除する場合は次のコマンドを実行してください: node scripts/seed-test-data.js --undo");
}


// レポートが読む「日ごとの集計」(daily_stats)は友だち・成果から作る派生データ。
// テストデータの投入・削除はそこに反映されないため、集計を消して、レポートが元のデータを直接読む状態に戻す
// (次に友だち追加・成果が記録されたとき、その翌日以降が自動で集計から読まれる状態になる)。
async function resetDailyStats() {
  for (const name of ["daily_stats", "daily_stats_meta"]) {
    for (;;) {
      const snap = await getDb().collection(name).limit(400).get();
      if (snap.empty) break;
      const batch = getDb().batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  }
  console.log("日ごとの集計(daily_stats)を消去しました(レポートは元のデータを直接読む状態に戻ります)");
}

async function undo() {
  console.log("テストデータ(userId/clickId/conversionIdが test_ で始まるもの)を削除します...");
  let totalDeleted = 0;
  for (const [collection, idField] of [
    ["friends", "userId"],
    ["clicks", "clickId"],
    ["conversions", "conversionId"],
  ]) {
    const snap = await getDb().collection(collection).get();
    const targets = snap.docs.filter((d) => (d.data()[idField] ?? d.id).startsWith(TEST_PREFIX));
    for (let i = 0; i < targets.length; i += 400) {
      const batch = getDb().batch();
      for (const doc of targets.slice(i, i + 400)) {
        batch.delete(doc.ref);
      }
      await batch.commit();
    }
    console.log(`  ${collection}: ${targets.length}件削除しました`);
    totalDeleted += targets.length;
  }
  console.log(`合計 ${totalDeleted}件のテストデータを削除しました`);
  await resetDailyStats();
}


// ------------------------------------------------------------------------------------------
// 期間指定の投入(--from / --to)
// ------------------------------------------------------------------------------------------
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

// "15-25" のような範囲指定を { min, max } にする
function parseRange(text, fallback, label) {
  if (text === undefined) return fallback;
  const m = /^(\d+)-(\d+)$/.exec(text);
  if (!m || Number(m[1]) > Number(m[2])) {
    console.error(`${label} は "最小-最大"(例: 15-25)の形式で指定してください: ${text}`);
    process.exit(1);
  }
  return { min: Number(m[1]), max: Number(m[2]) };
}

// 日付文字列(YYYY-MM-DD)の一覧(日本時間)
function enumerateDates(from, to) {
  const dates = [];
  for (let t = Date.parse(`${from}T00:00:00+09:00`); t <= Date.parse(`${to}T00:00:00+09:00`); t += DAY_MS) {
    dates.push(new Date(t + 9 * 60 * 60 * 1000).toISOString().slice(0, 10));
  }
  return dates;
}

// 1日ごとの件数を決めて、友だち・クリック・成果のデータを作る(Firestoreには書き込まない純粋な処理)。
// - 友だち追加: 1日 friendsRange.min〜max 人。追加の直前(0〜10分前)に、その流入経路リンクのクリックログも作る
// - CV: 1日 cvRange.min〜max 件。CVになる人は「その時点までに追加された友だち」からランダムに選び、
//       CVの前(1〜30分前)に購入リンクのクリックログも作る(友だち追加より前にはならない)
// - 上記に加え、離脱した流入経路クリック(約30%)と、CVに至らなかった購入リンククリック(CV数の約60%)も作る
// - 現在時刻(nowMs)より未来の時刻は作らない
function buildRangeData({ sources, purchaseLinks, from, to, friendsRange, cvRange, nowMs }) {
  const friends = [];
  const clicks = [];
  const conversions = [];
  const daily = [];
  const rand = randomInt;
  const nameOf = (source) => source.name ?? source.sourceId;

  for (const date of enumerateDates(from, to)) {
    const dayStart = Date.parse(`${date}T00:00:00+09:00`);
    const dayEnd = Math.min(dayStart + DAY_MS - 1, nowMs);
    if (dayEnd <= dayStart) {
      daily.push({ date, friends: 0, cvs: 0, skipped: true });
      continue;
    }

    // --- 友だち追加 ---
    const friendCount = rand(friendsRange.min, friendsRange.max);
    for (let i = 0; i < friendCount; i++) {
      const source = pick(sources);
      const userId = randomId();
      const addedAt = rand(dayStart + 11 * MIN_MS, dayEnd);
      const friend = {
        userId,
        displayName: `テスト友だち${date.slice(5).replace("-", "")}-${String(i + 1).padStart(2, "0")}`,
        sourceId: source.sourceId,
        latestSourceId: source.sourceId,
        addedAt,
      };
      if (Math.random() < 0.08) {
        friend.unfollowedAt = Math.min(addedAt + rand(1, 5) * DAY_MS, nowMs);
        if (friend.unfollowedAt <= addedAt) delete friend.unfollowedAt;
      }
      const clickId = randomId();
      friend.sourceClickId = clickId;
      friend.latestSourceClickId = clickId;
      friends.push(friend);
      clicks.push({
        clickId,
        linkType: "add_friend",
        sourceId: source.sourceId,
        userId,
        clickedAt: addedAt - rand(0, 10) * MIN_MS,
        friendSourceIdAtClick: source.sourceId,
        friendLatestSourceIdAtClick: source.sourceId,
        sourceNameAtClick: nameOf(source),
        statusAtClick: "not_added",
      });
    }

    // 友だち追加に至らず離脱した流入経路クリック(ユーザー未特定)
    const bounceCount = Math.round(friendCount * 0.3);
    for (let i = 0; i < bounceCount; i++) {
      const source = pick(sources);
      clicks.push({
        clickId: randomId(),
        linkType: "add_friend",
        sourceId: source.sourceId,
        clickedAt: rand(dayStart, dayEnd),
        sourceNameAtClick: nameOf(source),
        statusAtClick: "unidentified",
      });
    }

    // --- CV ---
    const cvCount = rand(cvRange.min, cvRange.max);
    let made = 0;
    let guard = 0;
    while (made < cvCount && guard++ < cvCount * 50) {
      const convertedAt = rand(dayStart + 40 * MIN_MS, dayEnd);
      // CVの31分前までに追加済みの友だち(前日までの友だちを含む)から選ぶ
      const candidates = friends.filter((f) => f.addedAt <= convertedAt - 31 * MIN_MS);
      if (candidates.length === 0) continue;
      const friend = pick(candidates);
      const purchaseLink = pick(purchaseLinks);
      const clickId = randomId();
      const clickedAt = Math.max(friend.addedAt, convertedAt - rand(1, 30) * MIN_MS);
      clicks.push({
        clickId,
        linkType: "purchase",
        sourceId: friend.sourceId,
        userId: friend.userId,
        purchaseLinkId: purchaseLink.purchaseLinkId,
        clickedAt,
        friendSourceIdAtClick: friend.sourceId,
        friendLatestSourceIdAtClick: friend.latestSourceId,
      });
      conversions.push({
        conversionId: randomId(),
        userId: friend.userId,
        sourceId: friend.sourceId,
        latestSourceId: friend.latestSourceId,
        purchaseLinkId: purchaseLink.purchaseLinkId,
        clickId,
        amount: rand(1, 9) * 1000,
        convertedAt,
      });
      made++;
    }

    // CVに至らなかった購入リンククリック
    const noCvClicks = Math.round(made * 0.6);
    for (let i = 0; i < noCvClicks; i++) {
      const clickedAt = rand(dayStart + 40 * MIN_MS, dayEnd);
      const candidates = friends.filter((f) => f.addedAt <= clickedAt - 1 * MIN_MS);
      if (candidates.length === 0) continue;
      const friend = pick(candidates);
      clicks.push({
        clickId: randomId(),
        linkType: "purchase",
        sourceId: friend.sourceId,
        userId: friend.userId,
        purchaseLinkId: pick(purchaseLinks).purchaseLinkId,
        clickedAt,
        friendSourceIdAtClick: friend.sourceId,
        friendLatestSourceIdAtClick: friend.latestSourceId,
      });
    }

    daily.push({ date, friends: friendCount, cvs: made });
  }

  return { friends, clicks, conversions, daily };
}

async function confirmProject() {
  const projectId = process.env.FB_PROJECT_ID;
  getDb(); // 環境変数の読み込み
  const projectIdLoaded = process.env.FB_PROJECT_ID;
  const readline = require("readline").createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) =>
    readline.question(`書き込んでよい場合は、対象のFirebaseプロジェクトID「${projectIdLoaded ?? projectId}」を入力してください: `, resolve)
  );
  readline.close();
  return String(answer).trim() === projectIdLoaded;
}

async function seedRange(args) {
  const argValue = (name) => {
    const i = args.indexOf(name);
    return i !== -1 ? args[i + 1] : undefined;
  };
  const from = argValue("--from");
  const to = argValue("--to") ?? from;
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!from || !datePattern.test(from) || !datePattern.test(to) || from > to) {
    console.error("--from / --to は YYYY-MM-DD の形式で、from <= to になるように指定してください(例: --from 2026-10-01 --to 2026-10-09)");
    process.exit(1);
  }
  const friendsRange = parseRange(argValue("--friends-per-day"), { min: 15, max: 25 }, "--friends-per-day");
  const cvRange = parseRange(argValue("--cv-per-day"), { min: 5, max: 10 }, "--cv-per-day");
  const dryRun = args.includes("--dry-run");

  loadEnvLocalIfPossible();
  const [sourcesSnap, purchaseLinksSnap] = await Promise.all([
    getDb().collection("sources").get(),
    getDb().collection("purchase_links").get(),
  ]);
  const sources = sourcesSnap.docs.map((d) => d.data());
  const purchaseLinks = purchaseLinksSnap.docs.map((d) => d.data());
  if (sources.length === 0 || purchaseLinks.length === 0) {
    console.error("流入経路(sources)と購入リンク(purchase_links)が、それぞれ1件以上登録されている必要があります。先に管理画面から登録してください。");
    process.exit(1);
  }
  console.log(`流入経路 ${sources.length}件・購入リンク ${purchaseLinks.length}件を使います`);

  const data = buildRangeData({ sources, purchaseLinks, from, to, friendsRange, cvRange, nowMs: Date.now() });
  console.log(`\n期間 ${from} 〜 ${to}(日本時間)、1日あたり 友だち追加${friendsRange.min}〜${friendsRange.max}人・CV ${cvRange.min}〜${cvRange.max}件`);
  data.daily.forEach((d) => {
    console.log(`  ${d.date}: ${d.skipped ? "(未来の日付のためスキップ)" : `友だち追加 ${d.friends}人 / CV ${d.cvs}件`}`);
  });
  const addFriendClicks = data.clicks.filter((c) => c.linkType === "add_friend").length;
  const purchaseClicks = data.clicks.filter((c) => c.linkType === "purchase").length;
  console.log(
    `\n合計: friends ${data.friends.length}件 / clicks ${data.clicks.length}件(流入経路クリック ${addFriendClicks}件・購入リンククリック ${purchaseClicks}件) / conversions ${data.conversions.length}件`
  );

  if (dryRun) {
    console.log("\n--dry-run のため、何も書き込んでいません。");
    return;
  }
  if (!(await confirmProject())) {
    console.log("入力が一致しないため、中止しました。何も書き込んでいません。");
    return;
  }

  // 友だち一覧の「ID」(idNumber)を、本番と同じ仕組み(counters/friendIdNumber)で採番する。
  // 追加日時が古い順に、現在のカウンタ値の続きから連番を振り、最後にカウンタも更新する。
  const counterRef = getDb().collection("counters").doc("friendIdNumber");
  const counterSnap = await counterRef.get();
  let nextId = (counterSnap.data()?.value ?? 0) + 1;
  [...data.friends].sort((a, b) => a.addedAt - b.addedAt).forEach((f) => {
    f.idNumber = nextId++;
  });

  const allWrites = [
    ...data.friends.map((doc) => ["friends", doc.userId, doc]),
    ...data.clicks.map((doc) => ["clicks", doc.clickId, doc]),
    ...data.conversions.map((doc) => ["conversions", doc.conversionId, doc]),
  ];
  for (let i = 0; i < allWrites.length; i += 400) {
    const batch = getDb().batch();
    for (const [collection, id, doc] of allWrites.slice(i, i + 400)) {
      batch.set(getDb().collection(collection).doc(id), doc);
    }
    await batch.commit();
  }
  await counterRef.set({ value: nextId - 1 }, { merge: true });
  console.log(`\n友だちIDを ${nextId - data.friends.length} 〜 ${nextId - 1} 番まで採番しました`);
  await resetDailyStats();
  console.log("\n書き込みが完了しました。削除する場合は次のコマンドを実行してください: node scripts/seed-test-data.js --undo");
}

function loadEnvLocalIfPossible() {
  getDb(); // 接続情報の確認(未設定ならここでメッセージを出して終了する)
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--undo")) {
    await undo();
    return;
  }
  if (args.includes("--from")) {
    await seedRange(args);
    return;
  }
  const countArg = args.find((a) => /^\d+$/.test(a));
  const count = countArg ? Number(countArg) : 100;
  await seed(count);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("エラーが発生しました:", e);
      process.exit(1);
    });
}

module.exports = { buildRangeData, enumerateDates, seedRange };
