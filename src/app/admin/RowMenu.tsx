"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// 一覧の各行に置く「⋯」メニュー。編集・複製・削除をまとめる。
//
// 表(テーブル)は「見出し固定・中身スクロール」にするため overflow: auto の枠で囲んでいる。
// メニューをそのまま絶対配置で表の中に置くと、その枠にはみ出た部分が切れて隠れてしまうため、
// ボタンの位置を計測した上でReactのポータルを使い、document.body直下に固定表示している。
export default function RowMenu({
  onEdit,
  onDuplicate,
  onDelete,
}: {
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const MENU_WIDTH = 120;

  function openMenu() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      setPos({
        top: rect.bottom + 4,
        left: Math.max(8, rect.right - MENU_WIDTH),
      });
    }
    setOpen(true);
  }

  function closeMenu() {
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      closeMenu();
    }
    // 表をスクロールしたり画面サイズが変わったりすると、計算済みの位置がずれるため一旦閉じる
    function handleScrollOrResize() {
      closeMenu();
    }

    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => (open ? closeMenu() : openMenu())}
        aria-label="操作メニュー"
        style={{
          border: "1px solid transparent",
          background: "transparent",
          borderRadius: 6,
          width: 28,
          height: 28,
          fontSize: 16,
          lineHeight: "28px",
          color: "#6b7280",
        }}
      >
        ⋯
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              zIndex: 1000,
              background: "#ffffff",
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
              minWidth: MENU_WIDTH,
              overflow: "hidden",
            }}
          >
            <MenuItem
              label="編集"
              onClick={() => {
                closeMenu();
                onEdit();
              }}
            />
            <MenuItem
              label="複製"
              onClick={() => {
                closeMenu();
                onDuplicate();
              }}
            />
            <MenuItem
              label="削除"
              danger
              onClick={() => {
                closeMenu();
                onDelete();
              }}
            />
          </div>,
          document.body
        )}
    </>
  );
}

function MenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "9px 14px",
        fontSize: 13.5,
        border: "none",
        background: "transparent",
        color: danger ? "#c0392b" : "#374151",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#f4f6f8")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {label}
    </button>
  );
}
