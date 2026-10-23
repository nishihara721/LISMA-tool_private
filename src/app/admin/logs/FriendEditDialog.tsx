"use client";

import { useState } from "react";
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

  const known = sources.some((s) => s.sourceId === target.sourceId) || target.sourceId === "direct";

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
        <select style={{ ...ui.input, maxWidth: "100%", marginBottom: 14 }} value={sourceId} onChange={(e) => setSourceId(e.target.value)} disabled={busy}>
          <option value="direct">直接追加</option>
          {!known && <option value={target.sourceId}>(現在の値: {target.sourceId})</option>}
          {sources.map((s) => (
            <option key={s.sourceId} value={s.sourceId}>
              {s.name}
            </option>
          ))}
        </select>

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
