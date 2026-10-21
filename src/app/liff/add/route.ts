import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { logEvent } from "@/lib/event-log";
import type { SourceDoc } from "@/types";

// このページの用途:
//
// 1. 友だち追加リンク(メインの用途):
//    /liff/add?mode=add_friend&sourceId=instagram_ad_a
//    → クリックを記録(LIFFでユーザーを特定) → リダイレクト先へ遷移
//    ※ 友だち追加後にどのuserIdが追加したかをfollow Webhookと突き合わせる必要があるため、
//      ここでのユーザー識別は必須(広告のように後回しにはできない)。
//
// 2. 広告(旧方式・後方互換用):
//    /liff/add?mode=purchase&purchaseLinkId=summer_campaign_a
//    新しく発行するリンクは /admin/purchase-links から取得すること(現在はLIFFを経由せず
//    直接LPを開く方式に置き換わっている)。
//
// このルートだけは、他の管理画面(/admin以下)と違ってReactのページとして実装せず、
// 生のHTML+素のJavaScriptを直接返している。友だち追加リンクは「クリックしてから
// リダイレクトするまで」の速さが最優先のため、Next.js/Reactのフレームワーク本体
// (JSバンドルのダウンロード・実行・画面の組み立て)を読み込む分の時間をまるごと省くのが狙い。
//
// リダイレクト先の決め方(add_friendモードの場合):
//   1. その流入経路(sources.sourceId)に「Lステップ流入経路リンク」が設定されていれば、そちらへリダイレクトする
//      (Lステップ側でもこの流入経路の計測をしたいケース向け。/admin/sources で流入経路ごとに設定する)
//   2. 設定されていなければ、.env.local の LINE_OFFICIAL_ACCOUNT_URL(通常の友だち追加URL)へリダイレクトする
// 上記1のためだけに、このルートでもFirestoreへの読み取りを1回行っている
// (sourceIdをキーにした単純なドキュメント取得のため、体感できるほどの遅延にはならない)。
const LIFF_SDK_URL = "https://static.line-scdn.net/liff/edge/2/sdk.js";

// LINEの仕様上、https://liff.line.me/{LIFF_ID}?mode=xxx のように "?" で繋いだクエリは
// liff.state というパラメータの中にURLエンコードされて渡ってくる(クライアント側のgetParamと同じロジック)。
function getServerParam(searchParams: URLSearchParams, key: string): string | null {
  const liffState = searchParams.get("liff.state");
  if (liffState) {
    const decoded = new URLSearchParams(liffState.startsWith("?") ? liffState.slice(1) : liffState);
    const v = decoded.get(key);
    if (v) return v;
  }
  return searchParams.get(key);
}

export async function GET(req: NextRequest) {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID ?? "";
  const defaultRedirectUrl = process.env.LINE_OFFICIAL_ACCOUNT_URL ?? "";

  const mode = getServerParam(req.nextUrl.searchParams, "mode") ?? "add_friend";
  const sourceId = getServerParam(req.nextUrl.searchParams, "sourceId") ?? undefined;

  let redirectUrl = defaultRedirectUrl;
  if (mode === "add_friend" && sourceId) {
    try {
      const sourceSnap = await adminDb.collection("sources").doc(sourceId).get();
      const lstepUrl = sourceSnap.exists ? (sourceSnap.data() as SourceDoc).lstepUrl : undefined;
      if (lstepUrl) redirectUrl = lstepUrl;
    } catch (e) {
      // 取得に失敗しても致命的にはせず、通常の友だち追加URLへフォールバックする
      await logEvent("error", "liff_add.source_lookup_failed", "流入経路のLステップリンク取得に失敗しました", {
        sourceId,
        error: String(e),
      });
    }
  }

  if (mode === "add_friend" && !redirectUrl) {
    await logEvent("error", "liff_add.no_redirect_url", "友だち追加リンクのリダイレクト先が未設定です", {
      sourceId,
    });
    return new NextResponse(
      "リダイレクト先が設定されていません。この流入経路にLステップ流入経路リンクを設定するか、.env.localのLINE_OFFICIAL_ACCOUNT_URL(公式アカウントの友だち追加URL、https://line.me/R/ti/p/@から始まるもの)を設定してください。",
      { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="preconnect" href="${LIFF_SDK_URL.split("/").slice(0, 3).join("/")}" />
<link rel="preload" as="script" href="${LIFF_SDK_URL}" />
<title>friend add</title>
<style>
  html, body { margin: 0; padding: 0; }
  body { display: flex; min-height: 100vh; align-items: center; justify-content: center; font-family: sans-serif; }
  .spinner { width: 32px; height: 32px; border: 3px solid #eee; border-top-color: #7bb8d4; border-radius: 50%; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .error { padding: 16px; text-align: center; }
  .error .detail { color: red; font-size: 12px; margin-top: 8px; word-break: break-all; }
</style>
</head>
<body>
<div id="spinner" class="spinner"></div>
<div id="error" class="error" style="display: none;">
  <p>エラーが発生しました</p>
  <p class="detail" id="error-detail"></p>
</div>
<script>
(function () {
  var LIFF_ID = ${JSON.stringify(liffId)};
  var REDIRECT_URL = ${JSON.stringify(redirectUrl)};
  var LIFF_SDK_URL = ${JSON.stringify(LIFF_SDK_URL)};

  function showError(message) {
    document.getElementById("spinner").style.display = "none";
    document.getElementById("error").style.display = "block";
    document.getElementById("error-detail").textContent = message;
  }

  // サーバー側に届かないタイプの不具合(SDK読み込み失敗・LIFF初期化失敗等)を報告する。
  // 投げっぱなしでよいため、送信自体の成否は待たない。
  function sendLogBeacon(stage, message, context) {
    try {
      var body = JSON.stringify({ level: "error", stage: stage, message: message, context: context });
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/logs/client", new Blob([body], { type: "text/plain" }));
      } else {
        fetch("/api/logs/client", { method: "POST", headers: { "Content-Type": "application/json" }, body: body, keepalive: true }).catch(function () {});
      }
    } catch (e) {
      // ログ送信自体の失敗は無視する(画面表示には影響させない)
    }
  }

  function appendQueryParam(url, key, value) {
    var sep = url.indexOf("?") === -1 ? "?" : "&";
    return url + sep + key + "=" + encodeURIComponent(value);
  }

  function generateClickId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return Date.now() + "-" + Math.random().toString(36).slice(2);
  }

  // LINEの仕様上、https://liff.line.me/{LIFF_ID}?mode=xxx のように "?" で繋いだクエリは
  // liff.state というパラメータの中にURLエンコードされて渡ってくる。
  function getParam(key) {
    var params = new URLSearchParams(window.location.search);
    var liffState = params.get("liff.state");
    if (liffState) {
      var decoded = new URLSearchParams(liffState.indexOf("?") === 0 ? liffState.slice(1) : liffState);
      var v = decoded.get(key);
      if (v) return v;
    }
    return params.get(key);
  }

  // liff.line.me経由で開かれた最初の1回だけ、URLのハッシュ(#以降)部分に
  // IDトークンが直接埋め込まれている。SDKの読み込み・init完了を待たずにこれを直接使えれば、
  // 通信なし(ほぼ瞬時)でクリック記録・リダイレクトまで進められる。
  function getIdTokenFromUrlFragment() {
    if (!window.location.hash) return null;
    var hash = new URLSearchParams(window.location.hash.slice(1));
    return hash.get("id_token");
  }

  function sendClickBeacon(payload) {
    var body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/track/click", new Blob([body], { type: "text/plain" }));
    } else {
      fetch("/api/track/click", { method: "POST", headers: { "Content-Type": "application/json" }, body: body, keepalive: true }).catch(function () {});
    }
  }

  function proceed(mode, sourceId, purchaseLinkId, idToken) {
    var clickId = generateClickId();
    sendClickBeacon({ clickId: clickId, linkType: mode, sourceId: sourceId, purchaseLinkId: purchaseLinkId, idToken: idToken });

    if (mode === "add_friend") {
      window.location.href = REDIRECT_URL;
    } else {
      var destination = getParam("destinationUrl") || "/";
      window.location.href = appendQueryParam(destination, "clickId", clickId);
    }
  }

  function loadLiffSdk() {
    return new Promise(function (resolve, reject) {
      if (window.liff) { resolve(); return; }
      var s = document.createElement("script");
      s.src = LIFF_SDK_URL;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("LIFF SDKの読み込みに失敗しました")); };
      document.head.appendChild(s);
    });
  }

  var mode = getParam("mode") || "add_friend";
  var sourceId = getParam("sourceId") || undefined;
  var purchaseLinkId = getParam("purchaseLinkId") || undefined;

  // 近道: URLのハッシュに直接IDトークンが乗っていれば、SDKを待たずに即座に進める
  var fastIdToken = getIdTokenFromUrlFragment();
  if (fastIdToken) {
    proceed(mode, sourceId, purchaseLinkId, fastIdToken);
  } else {
    loadLiffSdk()
      .then(function () {
        return window.liff.init({ liffId: LIFF_ID });
      })
      .then(function () {
        if (!window.liff.isLoggedIn()) {
          window.liff.login({ redirectUri: window.location.href });
          return;
        }
        var idToken = window.liff.getIDToken() || undefined;
        proceed(mode, sourceId, purchaseLinkId, idToken);
      })
      .catch(function (err) {
        var msg = err && err.message ? err.message : String(err);
        sendLogBeacon("liff_add.client_init_failed", "友だち追加ページでLIFFの初期化・ログイン処理に失敗しました", {
          mode: mode,
          sourceId: sourceId,
          error: msg,
        });
        showError(msg);
      });
  }
})();
</script>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
