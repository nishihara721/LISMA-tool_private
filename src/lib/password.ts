// 管理画面ログイン用パスワードのハッシュ化・照合。
// 追加の依存(bcrypt等)を増やさないよう、Node.js標準のcrypto(scrypt)を使う。
// 保存形式: "<saltの16進数>:<ハッシュの16進数>"
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const hashBuffer = Buffer.from(hash, "hex");
  const candidate = scryptSync(password, salt, KEY_LENGTH);
  if (hashBuffer.length !== candidate.length) return false;
  return timingSafeEqual(hashBuffer, candidate);
}
