import { nanoid } from "nanoid";
import { adminDb } from "@/lib/firebase-admin";
import type { EventLogDoc, LogLevel } from "@/types";

// 友だち追加・流入経路リンククリック・成果計測の過程で、通常と異なること(警告・エラー)が
// 起きた際に記録するためのヘルパー。エラーが起きた時に管理画面(/admin/logs/events)で
// 原因を追えるようにするのが目的なので、正常に完了した処理はここでは記録しない
// (正常系は clicks/friends/conversions 自体が記録として残るため)。
//
// ログの書き込み自体が失敗しても本来の処理を止めないよう、必ずここでtry/catchする。
export async function logEvent(
  level: LogLevel,
  stage: string,
  message: string,
  context?: Record<string, unknown>
): Promise<void> {
  try {
    const log: EventLogDoc = {
      logId: nanoid(12),
      level,
      stage,
      message,
      context,
      createdAt: Date.now(),
    };
    await adminDb.collection("event_logs").doc(log.logId).set(log);
  } catch (e) {
    // ログ基盤自体の障害で本処理を止めたくないため、ここは握りつぶしてコンソールに出すだけにする
    console.error("イベントログの書き込みに失敗:", e);
  }
}
