/**
 * line-friend-tool 購入CV計測スクリプト
 *
 * 【前提】購入リンクは https://liff.line.me/{LIFF ID}?purchaseLinkId=xxx の形式で発行し、
 * 遷移先のLP自体を、そのLIFFアプリの「エンドポイントURL」として登録しておくこと。
 * (/admin/purchase-links で購入リンクを発行する際に案内される)
 * こうすることで、LPはliff.line.me経由で直接開かれるため、自社サーバーを1回も経由せずに済み、
 * かつLIFFが「正しいLIFF起動である」と認識してログイン状態を渡してくれるようになる。
 * (LIFFのSDKは、liff.line.me経由で開かれた場合以外はログイン状態を正しく取得できない仕様のため)
 *
 * 【購入ページ(LP)側】ページ表示は一切ブロックせず、裏側でクリックを記録する
 *   <script src="https://あなたのアプリのURL/track.js" data-liff-id="あなたのLIFF ID"></script>
 *
 * 【サンクス(決済完了)ページ側】保存されたclickIdを送信してCVを記録する(LIFFの設置は不要)
 *   <script src="https://あなたのアプリのURL/track.js" data-conversion="true"></script>
 *
 * data-liff-id には、その購入リンクを発行する際に指定したLIFF IDと同じ値を指定してください。
 *
 * ユーザー特定は「LPがliff.line.me経由で開かれ、かつ既にログイン済み」の場合のみ行われます。
 * 特定できなくても(外部ブラウザで開かれた場合など)ページ表示・CV計測自体は問題なく動作し、
 * その場合は誰の購入か不明("未特定")のまま記録されます。
 *
 * 注意: 購入ページとサンクスページが同一ドメインである必要があります。
 * (localStorage/Cookieはドメインをまたいで共有できないため、
 *  決済代行サービスの別ドメインのページを経由する場合はこの方式は使えません。
 *  その場合はURLのクエリパラメータでclickIdを引き継ぐ方式に変更してください)
 */
(function () {
  var STORAGE_KEY = "lft_clickId";
  var COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30日
  var LIFF_SDK_URL = "https://static.line-scdn.net/liff/edge/2/sdk.js";
  var IDENTIFY_TIMEOUT_MS = 4000; // ユーザー特定にこの時間以上かかる場合は諦めて先に進む

  // LINEの仕様上、https://liff.line.me/{LIFF_ID}?purchaseLinkId=xxx のように
  // "?" で繋いだクエリは、実際にエンドポイントURLへ渡されるときに
  // liff.state というパラメータの中にURLエンコードされて格納される。
  function getLiffAwareParam(key) {
    try {
      var params = new URLSearchParams(window.location.search);
      var liffState = params.get("liff.state");
      if (liffState) {
        var decoded = new URLSearchParams(liffState.indexOf("?") === 0 ? liffState.slice(1) : liffState);
        var v = decoded.get(key);
        if (v) return v;
      }
      return params.get(key);
    } catch (e) {
      return null;
    }
  }

  function generateClickId() {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    return Date.now() + "-" + Math.random().toString(36).slice(2);
  }

  function saveClickId(clickId) {
    try {
      localStorage.setItem(STORAGE_KEY, clickId);
    } catch (e) {
      /* localStorageが使えない環境は無視 */
    }
    document.cookie =
      STORAGE_KEY + "=" + encodeURIComponent(clickId) + "; path=/; max-age=" + COOKIE_MAX_AGE;
  }

  function loadClickId() {
    try {
      var fromStorage = localStorage.getItem(STORAGE_KEY);
      if (fromStorage) return fromStorage;
    } catch (e) {
      /* ignore */
    }
    var match = document.cookie.match(new RegExp("(?:^|; )" + STORAGE_KEY + "=([^;]*)"));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function clearClickId() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      /* ignore */
    }
    document.cookie = STORAGE_KEY + "=; path=/; max-age=0";
  }

  // このscriptタグ自身のsrcから、APIの向き先(このツールが動いているオリジン)を割り出す
  function getApiOrigin(currentScript) {
    if (!currentScript || !currentScript.src) return "";
    try {
      return new URL(currentScript.src).origin;
    } catch (e) {
      return "";
    }
  }

  // 渡されたPromiseが指定時間内に終わらなくても、必ず(成功扱いで)先に進めるようにする
  function withTimeout(promise, ms) {
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () {
        if (!done) {
          done = true;
          resolve();
        }
      }, ms);
      promise
        .then(function (value) {
          if (!done) {
            done = true;
            clearTimeout(timer);
            resolve(value); // 取得した値をそのまま呼び出し元に渡す(以前はここで値を渡し忘れていた)
          }
        })
        .catch(function () {
          if (!done) {
            done = true;
            clearTimeout(timer);
            resolve();
          }
        });
    });
  }

  // サーバー側に届かないタイプの不具合(SDK読み込み失敗・LIFF初期化失敗・通信失敗等)を報告する。
  // 投げっぱなしでよいため送信の成否は待たない。track.js自体は他社ドメインのLP上で動くため、
  // /api/logs/client 宛のCORS許可済みエンドポイントに向けて送る。
  function sendLogBeacon(stage, message, context) {
    try {
      var body = JSON.stringify({ level: "error", stage: stage, message: message, context: context });
      if (typeof navigator !== "undefined" && "sendBeacon" in navigator) {
        navigator.sendBeacon(apiOrigin + "/api/logs/client", new Blob([body], { type: "text/plain" }));
      } else {
        fetch(apiOrigin + "/api/logs/client", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body,
          keepalive: true,
        }).catch(function () {});
      }
    } catch (e) {
      /* ログ送信自体の失敗は無視する */
    }
  }

  function loadLiffSdk() {
    return new Promise(function (resolve) {
      if (window.liff) {
        resolve();
        return;
      }
      var s = document.createElement("script");
      s.src = LIFF_SDK_URL;
      s.onload = function () {
        resolve();
      };
      s.onerror = function () {
        // 読み込みに失敗しても、識別を諦めて処理は続行する(ページ表示は止めない)が、
        // 原因追跡のため記録だけはしておく
        sendLogBeacon("track_js.sdk_load_failed", "track.js内でLIFF SDKの読み込みに失敗しました", {
          isConversionPage: isConversionPage,
        });
        resolve();
      };
      document.head.appendChild(s);
    });
  }

  // ページ表示を一切ブロックしないよう、成功・失敗にかかわらず必ず { idToken } の形で解決するPromiseを返す。
  // (取得できなければ idToken は null)
  function tryGetIdToken(liffId) {
    if (!liffId) return Promise.resolve({ idToken: null });

    var task = loadLiffSdk().then(function () {
      if (!window.liff) return { idToken: null };
      return window.liff
        .init({ liffId: liffId })
        .then(function () {
          if (!window.liff.isLoggedIn()) return { idToken: null };
          return { idToken: window.liff.getIDToken() || null };
        })
        .catch(function (e) {
          sendLogBeacon("track_js.liff_init_failed", "track.js内でLIFFの初期化・ログイン状態確認に失敗しました", {
            liffId: liffId,
            error: String(e),
          });
          return { idToken: null };
        });
    });

    return withTimeout(task, IDENTIFY_TIMEOUT_MS).then(function (result) {
      return result || { idToken: null };
    });
  }

  var currentScript = document.currentScript;
  var isConversionPage = !!(currentScript && currentScript.getAttribute("data-conversion") === "true");
  var liffId = currentScript ? currentScript.getAttribute("data-liff-id") : null;
  var apiOrigin = getApiOrigin(currentScript);

  if (isConversionPage) {
    // サンクスページ: LIFFの設置は不要。保存済みのclickIdでCVを記録するだけでよい。
    // (userIdは、LP到達時点で識別できていれば既にclicksドキュメントに入っている)
    var clickId = loadClickId();
    if (clickId) {
      fetch(apiOrigin + "/api/track/conversion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clickId: clickId }),
      })
        .then(function () {
          clearClickId(); // 二重計測防止のため、送信後は消しておく
        })
        .catch(function (e) {
          // 通信失敗時は何もしない(次回アクセス時に再送されることはない点に留意)が、
          // CVが記録されなかった可能性があるため原因追跡用に記録しておく
          sendLogBeacon("track_js.conversion_post_failed", "track.js内でCV計測APIへの送信に失敗しました", {
            clickId: clickId,
            error: String(e),
          });
        });
    }
  } else {
    // 購入ページ(LP): purchaseLinkIdが付いている(=購入リンクから直接来た)場合のみ、
    // 新しいクリックとして記録する。ページの表示自体は待たせない。
    var purchaseLinkId = getLiffAwareParam("purchaseLinkId");
    if (purchaseLinkId) {
      var newClickId = generateClickId();
      saveClickId(newClickId);

      tryGetIdToken(liffId).then(function (result) {
        var payload = {
          clickId: newClickId,
          linkType: "purchase",
          purchaseLinkId: purchaseLinkId,
        };
        if (result.idToken) payload.idToken = result.idToken;

        var body = JSON.stringify(payload);
        if (typeof navigator !== "undefined" && "sendBeacon" in navigator) {
          // Content-Typeを"text/plain"にしておくと、ブラウザがクロスオリジンの
          // 単純リクエストとして扱ってくれるため確実性が上がる(サーバー側は中身がJSON文字列であれば
          // Content-Typeに関わらず正しく解析できる)
          var blob = new Blob([body], { type: "text/plain" });
          navigator.sendBeacon(apiOrigin + "/api/track/click", blob);
        } else {
          fetch(apiOrigin + "/api/track/click", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: body,
            keepalive: true,
          }).catch(function (e) {
            sendLogBeacon("track_js.click_post_failed", "track.js内で購入リンクのクリック記録APIへの送信に失敗しました", {
              purchaseLinkId: purchaseLinkId,
              error: String(e),
            });
          });
        }
      });
    }
  }
})();
