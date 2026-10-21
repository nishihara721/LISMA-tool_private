import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// report-dashboard と同じ FB_ プレフィックスの環境変数構成に合わせている
function getAdminApp(): App {
  if (getApps().length > 0) {
    return getApps()[0];
  }

  const projectId = process.env.FB_PROJECT_ID;
  const clientEmail = process.env.FB_CLIENT_EMAIL;
  // Vercel等の環境変数では改行が \n エスケープされて入るため復元する
  const privateKey = process.env.FB_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Firebase Admin の環境変数(FB_PROJECT_ID / FB_CLIENT_EMAIL / FB_PRIVATE_KEY)が未設定です"
    );
  }

  return initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
}

export const adminDb = getFirestore(getAdminApp());

// displayName/pictureUrl/sourceClickId等、値が取得できず undefined になるフィールドがあるため、
// Firestoreへの書き込み時にそれらを自動的に無視する設定にしておく。
// 開発時のホットリロードで本ファイルが再実行されると settings() の二重呼び出しでエラーになるため、
// 2回目以降は無視する。
try {
  adminDb.settings({ ignoreUndefinedProperties: true });
} catch {
  // すでに設定済みの場合はここに来る(ホットリロード時など)。無視してよい。
}
