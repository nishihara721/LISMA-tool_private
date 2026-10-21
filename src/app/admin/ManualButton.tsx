"use client";

import { usePathname } from "next/navigation";
import { manualUrlFor } from "@/lib/admin-pages";
import type { AdminRole } from "@/lib/session";

// 各ページの右上(タイトルと同じ高さ)に置く、表示中のページに対応するマニュアルを新しいタブで開くボタン。
export default function ManualButton({ role }: { role: AdminRole }) {
  const pathname = usePathname();
  return (
    <div style={{ position: "absolute", top: 34, right: 40, zIndex: 5 }}>
      <a
        href={manualUrlFor(pathname, role)}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 12px",
          fontSize: 12.5,
          color: "#3f8fb8",
          textDecoration: "none",
          border: "1px solid #b9d8e8",
          borderRadius: 999,
          background: "#ffffff",
        }}
      >
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: "#3f8fb8",
            color: "#ffffff",
            fontSize: 11,
            fontWeight: 700,
            lineHeight: "16px",
            textAlign: "center",
          }}
        >
          ?
        </span>
        このページのマニュアル
      </a>
    </div>
  );
}
