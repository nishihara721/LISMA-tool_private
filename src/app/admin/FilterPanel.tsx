"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import * as ui from "./ui";

// 各ページ上部の絞り込み欄。PCでは従来どおり常に表示し、スマホ幅では「絞り込み」ボタンで開閉できる
// (画面が狭いと絞り込み欄が長くなり、一覧が見えなくなるため、普段は閉じておく)。
// 開閉の見た目の切り替えは globals.css の .filter-panel 系のクラスで行っている。
export default function FilterPanel({ style, children }: { style?: CSSProperties; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`filter-panel${open ? " filter-panel--open" : ""}`}>
      <button type="button" className="filter-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>絞り込み</span>
        <span aria-hidden>{open ? "▲" : "▼"}</span>
      </button>
      <div className="filter-panel-body" style={{ ...ui.filterBar, ...style }}>
        {children}
      </div>
    </div>
  );
}
