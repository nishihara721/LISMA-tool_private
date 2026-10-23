"use client";

import { createContext, useContext } from "react";
import type { AdminRole } from "@/lib/session";

// レポート閲覧権限のユーザーには、各レポート画面の「編集」ボタン(PV数・imp数・CL数の手動修正)を
// 表示しないようにするため、ログインユーザーの権限をサーバーコンポーネント(layout.tsx)から
// クライアントコンポーネント(各レポートページ)へ伝えるためのContext。
// 実際の編集可否はサーバー側(proxy.ts)でも強制しているため、ここでの非表示は見た目の制御のみ。
const CurrentUserContext = createContext<{ role: AdminRole }>({ role: "admin" });

export function CurrentUserProvider({ role, children }: { role: AdminRole; children: React.ReactNode }) {
  return <CurrentUserContext.Provider value={{ role }}>{children}</CurrentUserContext.Provider>;
}

export function useCanEditReports(): boolean {
  return useContext(CurrentUserContext).role === "admin";
}
