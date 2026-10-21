"use client";

import { useEffect, useRef, useState } from "react";
import * as ui from "./ui";

// 絞り込み用の複数選択プルダウン。チェックを付けた項目のどれかに一致するものを表示する(何も選ばなければ「すべて」)。
// 選択肢が多い場合に探しやすいよう、選択肢の絞り込み入力と、「すべて選択」「選択を解除」を備える。
export default function MultiSelect({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  // 枠の外をクリックしたら閉じる
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const selected = new Set(value);
  const visible = query ? options.filter((o) => o.toLowerCase().includes(query.toLowerCase())) : options;
  const summary = value.length === 0 ? "すべて" : value.length === 1 ? value[0] : `${value.length}件選択中`;

  function toggle(name: string) {
    onChange(selected.has(name) ? value.filter((v) => v !== name) : [...value, name]);
  }

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={value.join("、")}
        style={{
          ...ui.filterSelect,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          width: "100%",
          maxWidth: 260,
          textAlign: "left",
          background: "#ffffff",
          cursor: "pointer",
          color: value.length === 0 ? "#6b7280" : "#111827",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summary}</span>
        <span aria-hidden style={{ fontSize: 10, color: "#6b7280" }}>
          ▼
        </span>
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            zIndex: 30,
            width: 300,
            maxWidth: "80vw",
            padding: 8,
            background: "#ffffff",
            border: "1px solid #d1d5db",
            borderRadius: 8,
            boxShadow: "0 6px 20px rgba(0,0,0,0.12)",
          }}
        >
          <input
            type="text"
            placeholder="選択肢を絞り込む"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ ...ui.filterInput, width: "100%", boxSizing: "border-box", marginBottom: 6 }}
          />
          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <button type="button" style={ui.buttonSmall} onClick={() => onChange(Array.from(new Set([...value, ...visible])))}>
              {query ? "表示中をすべて選択" : "すべて選択"}
            </button>
            <button type="button" style={ui.buttonSmall} onClick={() => onChange([])} disabled={value.length === 0}>
              選択を解除
            </button>
          </div>
          <div style={{ maxHeight: 260, overflowY: "auto" }}>
            {visible.length === 0 ? (
              <p style={{ fontSize: 12.5, color: "#6b7280", margin: "6px 4px" }}>該当する選択肢がありません</p>
            ) : (
              visible.map((name) => (
                <label
                  key={name}
                  style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "4px 4px", fontSize: 13, cursor: "pointer", lineHeight: 1.5 }}
                >
                  <input type="checkbox" checked={selected.has(name)} onChange={() => toggle(name)} style={{ marginTop: 3 }} />
                  <span style={{ wordBreak: "break-all" }}>{name}</span>
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
