"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import * as ui from "../../ui";
import { buildSourceName } from "@/lib/source-name";

export default function NewSourcePage() {
  const router = useRouter();
  const [placement, setPlacement] = useState("");
  const [appeal, setAppeal] = useState("");
  const [popup, setPopup] = useState("");
  const [scenario, setScenario] = useState("");
  const [exitPoint, setExitPoint] = useState("");
  const [intermediatePage, setIntermediatePage] = useState("");
  const [other, setOther] = useState("");
  const [lstepUrl, setLstepUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const previewName = buildSourceName({
    placement,
    appeal,
    popup,
    scenario,
    exitPoint,
    intermediatePage,
    other,
  });

  async function handleCreate() {
    if (!previewName) {
      alert("いずれかの項目を入力してください");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          placement,
          appeal,
          popup,
          scenario,
          exitPoint,
          intermediatePage,
          other,
          lstepUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push("/admin/sources");
    } catch (e) {
      alert(`作成に失敗しました: ${e}`);
      setBusy(false);
    }
  }

  return (
    <main style={ui.page}>
      <Link href="/admin/sources" style={ui.backLink}>
        ← 流入経路一覧へ戻る
      </Link>
      <h1 style={ui.h1}>流入経路の新規登録</h1>

      <section style={ui.section}>
        <div style={ui.field}>
          <label style={ui.label}>設置先</label>
          <input style={ui.input} value={placement} onChange={(e) => setPlacement(e.target.value)} autoFocus placeholder="例: LP上部" />
        </div>
        <div style={ui.field}>
          <label style={ui.label}>訴求</label>
          <input style={ui.input} value={appeal} onChange={(e) => setAppeal(e.target.value)} placeholder="例: 夏セール訴求" />
        </div>
        <div style={ui.field}>
          <label style={ui.label}>ポップアップ</label>
          <input style={ui.input} value={popup} onChange={(e) => setPopup(e.target.value)} placeholder="例: ポップアップA" />
        </div>
        <div style={ui.field}>
          <label style={ui.label}>シナリオ</label>
          <input style={ui.input} value={scenario} onChange={(e) => setScenario(e.target.value)} placeholder="例: シナリオ1" />
        </div>
        <div style={ui.field}>
          <label style={ui.label}>離脱地点</label>
          <input
            style={ui.input}
            value={exitPoint}
            onChange={(e) => setExitPoint(e.target.value)}
            placeholder="例: 離脱ポイントA"
          />
        </div>
        <div style={ui.field}>
          <label style={ui.label}>中間ページ</label>
          <input
            style={ui.input}
            value={intermediatePage}
            onChange={(e) => setIntermediatePage(e.target.value)}
            placeholder="例: 中間ページ2"
          />
        </div>
        <div style={ui.field}>
          <label style={ui.label}>その他</label>
          <input style={ui.input} value={other} onChange={(e) => setOther(e.target.value)} placeholder="上記に当てはまらない要素があれば" />
        </div>
        <div style={ui.field}>
          <label style={ui.label}>表示名(プレビュー)</label>
          <p style={{ ...ui.hint, fontSize: 13.5 }}>{previewName || "(いずれかの項目を入力してください)"}</p>
        </div>
        <div style={ui.field}>
          <label style={ui.label}>Lステップの流入経路リンク(任意)</label>
          <input
            style={ui.input}
            value={lstepUrl}
            onChange={(e) => setLstepUrl(e.target.value)}
            placeholder="https://line.me/R/ti/p/@xxx?... など"
          />
          <p style={ui.hint}>
            設定すると、この流入経路の友だち追加リンクをクリックした際に、公式アカウントの通常の友だち追加ページではなく、ここで指定したLステップの流入経路リンクへリダイレクトされます(Lステップ側でも流入経路を計測したい場合に使用)。空欄の場合は通常の友だち追加ページへリダイレクトします。
          </p>
        </div>
        <button style={ui.buttonPrimary} onClick={handleCreate} disabled={busy}>
          {busy ? "登録中..." : "登録する"}
        </button>
      </section>
    </main>
  );
}
