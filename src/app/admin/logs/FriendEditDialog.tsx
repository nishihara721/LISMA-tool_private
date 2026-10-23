"use client";

import { useMemo, useState } from "react";
import * as ui from "../ui";

export type FriendEditTarget = {
  userId: string;
  displayName: string;
  sourceId: string;
  addedAt: number;
  preExisting: boolean;
  addedAtEstimated: boolean;
};

// 日本時間の「YYYY-MM-DDTHH:mm」(datetime-local用)と、ミリ秒の相互変換
const toLocalInput = (ms: number) => new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 16);
const fromLocalInput = (v: string) => Date.parse(`${v}:00+09:00`);

// 友だち一覧の鉛筆アイコンから開く、友だち1人の「友だち追加時の流入経路」「友だち追加日時」の手動変更ダイアログ。
// 追加日時は「導入前」の友だちだけ変更できる。
export default function FriendEditDialog({
  target,
  sources,
  onClose,
  onSaved,
}: {
  target: FriendEditTarget;
  sources: { sourceId: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [sourceId, setSourceId] = useState(target.sourceId);
  const [addedAt, setAddedAt] = useState(toLocalInput(target.addedAt));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    try {
      const body: { sourceId: string; addedAt?: number } = { sourceId };
      if (target.preExisting) {
        const ms = fromLocalInput(addedAt);
        if (!Number.isFinite(ms)) throw new Error("友だち追加日時を入力してください");
        body.addedAt = ms;
      }
      const res = await fetch(`/api/admin/friends/${encodeURIComponent(target.userId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "更新に失敗しました");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // 選択肢: 「直接追加」+ 登録済みの流入経路。現在の値がどちらにも無い場合(削除済みの流入経路など)は、その値も選択肢に残す
  const options = useMemo(() => {
    const list = [{ sourceId: "direct", name: "直接追加" }, ...sources];
    if (target.sourceId && !list.some((o) => o.sourceId === target.sourceId)) {
      list.push({ sourceId: target.sourceId, name: `(現在の値: ${target.sourceId})` });
    }
    return list;
  }, [sources, target.sourceId]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div style={{ background: "#ffffff", borderRadius: 10, padding: 24, width: 420, maxWidth: "92vw", boxShadow: "0 8px 30px rgba(0,0,0,0.2)" }}>
        <h2 style={{ ...ui.h2, marginTop: 0 }}>友だち情報の変更</h2>
        <p style={{ fontSize: 13, margin: "0 0 14px" }}>{target.displayName}</p>

        <label style={ui.label}>友だち追加時の流入経路</label>
        <SourcePicker
          options={options}
          value={sourceId}
          onChange={setSourceId}
          disabled={busy}
        />

        <label style={ui.label}>友だち追加日時(日本時間)</label>
        {target.preExisting ? (
          <>
            <input type="datetime-local" style={{ ...ui.input, maxWidth: "100%" }} value={addedAt} onChange={(e) => setAddedAt(e.target.value)} disabled={busy} />
            {target.addedAtEstimated && <p style={ui.hint}>追加日時は未確定です(保存すると確定し、その日の友だち追加数に加わります)。</p>}
          </>
        ) : (
          <p style={ui.hint}>通常の友だちの追加日時は、友だち追加時に記録された正しい値のため変更できません(導入前の友だちのみ変更できます)。</p>
        )}

        {error && <p style={{ color: "#c0392b", fontSize: 13 }}>{error}</p>}
        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          <button type="button" style={{ ...ui.buttonPrimary, padding: "6px 18px", fontSize: 12.5 }} onClick={save} disabled={busy}>
            {busy ? "保存中…" : "保存"}
          </button>
          <button type="button" style={{ ...ui.buttonSmall, padding: "6px 18px" }} onClick={onClose} disabled={busy}>
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}

// 流入経路名を検索して選ぶ入力欄。入力した文字を含む流入経路だけを一覧に出す(大文字小文字・全角半角の違いは区別しない)。
// 一覧は枠の中でスクロールでき、1件だけに絞られた状態でEnterを押すとその流入経路を選ぶ。
function SourcePicker({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { sourceId: string; name: string }[];
  value: string;
  onChange: (sourceId: string) => void;
  disabled: boolean;
}) {
  const [query, setQuery] = useState("");
  const norm = (v: string) => v.normalize("NFKC").toLowerCase();
  const q = norm(query.trim());
  const visible = q ? options.filter((o) => norm(o.name).includes(q)) : options;
  const current = options.find((o) => o.sourceId === value);

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 13, marginBottom: 6 }}>
        選択中:<strong>{current?.name ?? value}</strong>
      </div>
      <input
        type="text"
        placeholder="流入経路名で検索"
        style={{ ...ui.input, maxWidth: "100%", marginBottom: 6 }}
        value={query}
        disabled={disabled}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault(); // Enterでダイアログが閉じたり送信されたりしないようにする
            if (visible.length === 1) onChange(visible[0].sourceId);
          }
        }}
      />
      <div
        role="listbox"
        aria-label="流入経路"
        style={{ maxHeight: 180, overflowY: "auto", border: "1px solid #d9dee3", borderRadius: 6, background: "#ffffff" }}
      >
        {visible.length === 0 && <div style={{ padding: "8px 10px", fontSize: 12.5, color: "#6b7280" }}>該当する流入経路がありません</div>}
        {visible.map((o) => {
          const selected = o.sourceId === value;
          return (
            <button
              key={o.sourceId}
              type="button"
              role="option"
              aria-selected={selected}
              disabled={disabled}
              onClick={() => onChange(o.sourceId)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "7px 10px",
                border: "none",
                borderBottom: "1px solid #eef0f3",
                background: selected ? "#e8f0fe" : "#ffffff",
                fontWeight: selected ? 600 : 400,
                fontSize: 13,
                cursor: disabled ? "default" : "pointer",
                wordBreak: "break-all",
              }}
            >
              {o.name}
            </button>
          );
        })}
      </div>
      {q && <p style={ui.hint}>{visible.length}件が見つかりました</p>}
    </div>
  );
}
