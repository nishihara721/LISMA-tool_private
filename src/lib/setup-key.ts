// 「初回セットアップ」「ID・パスワードを忘れた場合」の画面で本人確認に使う、セットアップキーの検証。
//
// ログイン前の画面から管理者アカウントを作成・復旧できるため、誰にでも実行できてしまわないよう、
// サーバーの環境変数 ADMIN_SETUP_KEY(サーバーを管理できる人だけが知っている値)を知っていることを条件にしている。
// - ADMIN_SETUP_KEY が未設定、または短すぎる場合は、この機能全体を無効にする(安全側に倒す)
// - 連続して間違えた場合はロックして、総当たりで当てられないようにする
import { timingSafeEqual } from "crypto";
import { adminDb } from "@/lib/firebase-admin";

export const MIN_SETUP_KEY_LENGTH = 16;
const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;
const THROTTLE_DOC = "setup_key";

export function isSetupKeyConfigured(): boolean {
  return (process.env.ADMIN_SETUP_KEY ?? "").length >= MIN_SETUP_KEY_LENGTH;
}

export type SetupKeyCheck =
  | { ok: true }
  | { ok: false; reason: "not_configured" | "locked" | "invalid"; message: string };

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function checkSetupKey(input: unknown): Promise<SetupKeyCheck> {
  const expected = process.env.ADMIN_SETUP_KEY ?? "";
  if (expected.length < MIN_SETUP_KEY_LENGTH) {
    return {
      ok: false,
      reason: "not_configured",
      message: `サーバーの環境変数 ADMIN_SETUP_KEY が未設定です(${MIN_SETUP_KEY_LENGTH}文字以上で設定してください)`,
    };
  }

  const ref = adminDb.collection("auth_throttle").doc(THROTTLE_DOC);
  const snap = await ref.get();
  const state = snap.data() as { failCount?: number; lockedUntil?: number } | undefined;
  if (state?.lockedUntil && state.lockedUntil > Date.now()) {
    const minutes = Math.ceil((state.lockedUntil - Date.now()) / 60000);
    return {
      ok: false,
      reason: "locked",
      message: `セットアップキーを連続で間違えたため、ロックされています。約${minutes}分後にやり直してください`,
    };
  }

  if (typeof input === "string" && safeEqual(input, expected)) {
    if (snap.exists) await ref.delete();
    return { ok: true };
  }

  const failCount = (state?.failCount ?? 0) + 1;
  if (failCount >= MAX_FAILURES) {
    await ref.set({ failCount: 0, lockedUntil: Date.now() + LOCK_MINUTES * 60000 });
    return {
      ok: false,
      reason: "locked",
      message: `セットアップキーを${MAX_FAILURES}回間違えたため、${LOCK_MINUTES}分間ロックしました`,
    };
  }
  await ref.set({ failCount, lockedUntil: 0 });
  return {
    ok: false,
    reason: "invalid",
    message: `セットアップキーが正しくありません(あと${MAX_FAILURES - failCount}回でロックされます)`,
  };
}
