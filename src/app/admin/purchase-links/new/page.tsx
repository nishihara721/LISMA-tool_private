"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import * as ui from "../../ui";
import { buildPurchaseLinkName, ordinal } from "@/lib/purchase-link-name";

export default function NewPurchaseLinkPage() {
  const router = useRouter();
  const [scenarioNumber, setScenarioNumber] = useState("");
  const [messageCount, setMessageCount] = useState("");
  const [other, setOther] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [destinationUrl, setDestinationUrl] = useState("");
  const [liffId, setLiffId] = useState("");
  const [busy, setBusy] = useState(false);

  const scenarioNum = scenarioNumber.trim() === "" ? undefined : Number(scenarioNumber);
  const scenarioText = typeof scenarioNum === "number" && !Number.isNaN(scenarioNum) ? ordinal(scenarioNum) : undefined;
  const messageCountNum = messageCount.trim() === "" ? undefined : Number(messageCount);
  const previewName = buildPurchaseLinkName({ scenario: scenarioText, messageCount: messageCountNum, other });

  async function handleCreate() {
    if (!previewName) {
      alert("いずれかの項目を入力してください");
      return;
    }
    if (scenarioNumber.trim() !== "" && Number.isNaN(scenarioNum)) {
      alert("シナリオは数値で入力してください");
      return;
    }
    if (messageCount.trim() !== "" && Number.isNaN(messageCountNum)) {
      alert("通数は数値で入力してください");
      return;
    }
    const unitPriceNum = unitPrice.trim() === "" ? undefined : Number(unitPrice);
    if (unitPriceNum !== undefined && (Number.isNaN(unitPriceNum) || unitPriceNum < 0)) {
      alert("成果単価は0以上の数値で入力してください");
      return;
    }
    if (!destinationUrl || !liffId) {
      alert("遷移先URL・LIFF IDを入力してください");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/purchase-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenario: scenarioText,
          messageCount: messageCountNum,
          other,
          unitPrice: unitPrice.trim() === "" ? undefined : Number(unitPrice),
          destinationUrl,
          liffId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push("/admin/purchase-links");
    } catch (e) {
      alert(`作成に失敗しました: ${e}`);
      setBusy(false);
    }
  }

  return (
    <main style={ui.page}>
      <Link href="/admin/purchase-links" style={ui.backLink}>
        ← 広告一覧へ戻る
      </Link>
      <h1 style={ui.h1}>広告の新規登録</h1>

      <section style={ui.section}>
        <div style={ui.field}>
          <label style={ui.label}>シナリオ</label>
          <input
            type="number"
            style={{ ...ui.input, maxWidth: 140 }}
            value={scenarioNumber}
            onChange={(e) => setScenarioNumber(e.target.value)}
            autoFocus
            placeholder="例: 1"
          />
          <p style={ui.hint}>数字だけ入力すると「{scenarioText ?? "1st"}」のように自動で表記が付きます。</p>
        </div>
        <div style={ui.field}>
          <label style={ui.label}>通数</label>
          <input
            type="number"
            style={{ ...ui.input, maxWidth: 140 }}
            value={messageCount}
            onChange={(e) => setMessageCount(e.target.value)}
            placeholder="例: 500"
          />
          <p style={ui.hint}>数字だけ入力すると「◯通目」の形式になります。</p>
        </div>
        <div style={ui.field}>
          <label style={ui.label}>その他</label>
          <input style={ui.input} value={other} onChange={(e) => setOther(e.target.value)} placeholder="例: 夏キャンペーンA商品" />
        </div>
        <div style={ui.field}>
          <label style={ui.label}>表示名(プレビュー)</label>
          <p style={{ ...ui.hint, fontSize: 13.5 }}>{previewName || "(いずれかの項目を入力してください)"}</p>
        </div>
        <div style={ui.field}>
          <label style={ui.label}>成果単価(円)</label>
          <input
            type="number"
            min={0}
            style={{ ...ui.input, maxWidth: 140 }}
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
            placeholder="例: 3000"
          />
          <p style={ui.hint}>この広告の成果1件あたりの金額です。各レポートの「請求額」は、成果数 × この単価で集計します(未入力は0円として扱います)。</p>
        </div>
        <div style={ui.field}>
          <label style={ui.label}>遷移先URL(実際の購入ページ)</label>
          <input
            style={ui.input}
            value={destinationUrl}
            onChange={(e) => setDestinationUrl(e.target.value)}
            placeholder="https://example.com/product/123"
          />
        </div>
        <div style={ui.field}>
          <label style={ui.label}>このページを登録したLIFF ID</label>
          <input
            style={ui.input}
            value={liffId}
            onChange={(e) => setLiffId(e.target.value)}
            placeholder="例: 2001234567-AbCdEfGh"
          />
          <p style={ui.hint}>
            事前にLINE Developersコンソールで、上記の遷移先URLを「エンドポイントURL」として登録したLIFFアプリを作成し、そのIDを入力してください。
          </p>
        </div>
        <button style={ui.buttonPrimary} onClick={handleCreate} disabled={busy}>
          {busy ? "登録中..." : "登録する"}
        </button>
      </section>
    </main>
  );
}
