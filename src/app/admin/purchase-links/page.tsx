"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import type { PurchaseLinkDoc } from "@/types";
import * as ui from "../ui";
import RowMenu from "../RowMenu";
import Pager from "../Pager";
import { buildPurchaseLinkName, ordinal } from "@/lib/purchase-link-name";

type EditFields = {
  scenarioNumber: string;
  messageCount: string;
  other: string;
  unitPrice: string;
  destinationUrl: string;
  liffId: string;
};

const EMPTY_EDIT: EditFields = { scenarioNumber: "", messageCount: "", other: "", unitPrice: "", destinationUrl: "", liffId: "" };

// 既存の「シナリオ」表示値(例: "1st")から、編集欄に戻すための数値部分を取り出す。
// 「1st」「2nd」のような序数表記以外(旧仕様の自由入力テキストなど)は数値化できないためnullを返す。
function parseScenarioNumber(scenario: string | undefined): number | null {
  if (!scenario) return null;
  const m = scenario.match(/^(\d+)(st|nd|rd|th)$/i);
  return m ? Number(m[1]) : null;
}

export default function PurchaseLinksAdminPage() {
  const [links, setLinks] = useState<PurchaseLinkDoc[]>([]);
  const [busy, setBusy] = useState(false);
  // 50件ずつ表示する
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditFields>(EMPTY_EDIT);

  useEffect(() => {
    fetchLinks();
  }, []);

  async function fetchLinks() {
    const res = await fetch("/api/purchase-links");
    const data = await res.json();
    setLinks(data.purchaseLinks ?? []);
  }

  function startEdit(link: PurchaseLinkDoc) {
    setEditingId(link.purchaseLinkId);
    const scenarioNum = parseScenarioNumber(link.scenario);
    // 数値化できない古いシナリオ値(旧仕様の自由入力テキスト)は、中身を失わないよう
    // 「その他」に元の値を引き継いで編集できるようにする(流入経路の既存データ移行と同じ考え方)
    const legacyScenarioText = link.scenario && scenarioNum === null ? link.scenario : "";
    setEdit({
      scenarioNumber: scenarioNum !== null ? String(scenarioNum) : "",
      messageCount: link.messageCount !== undefined ? String(link.messageCount) : "",
      other:
        link.other ??
        (!link.scenario && link.messageCount === undefined ? link.name : legacyScenarioText),
      unitPrice: link.unitPrice !== undefined ? String(link.unitPrice) : "",
      destinationUrl: link.destinationUrl,
      liffId: link.liffId,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEdit(EMPTY_EDIT);
  }

  const editScenarioNum = edit.scenarioNumber.trim() === "" ? undefined : Number(edit.scenarioNumber);
  const editScenarioText =
    typeof editScenarioNum === "number" && !Number.isNaN(editScenarioNum) ? ordinal(editScenarioNum) : undefined;

  const editPreviewName = buildPurchaseLinkName({
    scenario: editScenarioText,
    messageCount: edit.messageCount.trim() === "" ? undefined : Number(edit.messageCount),
    other: edit.other,
  });

  async function handleUpdate(purchaseLinkId: string) {
    if (!editPreviewName) {
      alert("いずれかの項目を入力してください");
      return;
    }
    if (edit.scenarioNumber.trim() !== "" && Number.isNaN(editScenarioNum)) {
      alert("シナリオは数値で入力してください");
      return;
    }
    const messageCountNum = edit.messageCount.trim() === "" ? undefined : Number(edit.messageCount);
    if (edit.messageCount.trim() !== "" && Number.isNaN(messageCountNum)) {
      alert("通数は数値で入力してください");
      return;
    }
    const unitPriceNum = edit.unitPrice.trim() === "" ? undefined : Number(edit.unitPrice);
    if (unitPriceNum !== undefined && (Number.isNaN(unitPriceNum) || unitPriceNum < 0)) {
      alert("成果単価は0以上の数値で入力してください");
      return;
    }
    if (!edit.destinationUrl || !edit.liffId) {
      alert("遷移先URL・LIFF IDを入力してください");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/purchase-links/${purchaseLinkId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenario: editScenarioText,
          messageCount: messageCountNum,
          other: edit.other,
          unitPrice: unitPriceNum,
          destinationUrl: edit.destinationUrl,
          liffId: edit.liffId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      cancelEdit();
      await fetchLinks();
    } catch (e) {
      alert(`更新に失敗しました: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDuplicate(link: PurchaseLinkDoc) {
    setBusy(true);
    try {
      const res = await fetch("/api/purchase-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenario: link.scenario,
          messageCount: link.messageCount,
          // 構成要素が1つも無い既存データはnameを、それ以外は既存の「その他」を引き継ぎつつ
          // 「のコピー」を付けて区別できるようにする
          unitPrice: link.unitPrice,
          other: `${link.other ?? (!link.scenario && link.messageCount === undefined ? link.name : "")}のコピー`,
          destinationUrl: link.destinationUrl,
          liffId: link.liffId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await fetchLinks();
    } catch (e) {
      alert(`複製に失敗しました: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(link: PurchaseLinkDoc) {
    if (!confirm(`「${link.name}」を削除しますか？(すでに計測されたクリック・成果のデータは残ります)`)) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/purchase-links/${link.purchaseLinkId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await fetchLinks();
    } catch (e) {
      alert(`削除に失敗しました: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  // 遷移先URL(destinationUrl)を「エンドポイントURL」として登録済みのLIFFアプリのIDを使う。
  // これにより、liff.line.meを経由して直接そのページへ遷移する(途中に自社サーバーを挟まない)ため、
  // ページ表示が速く、かつLIFF側でも正しくログイン状態を認識できる。
  function trackingLink(link: PurchaseLinkDoc) {
    return `https://liff.line.me/${link.liffId}?purchaseLinkId=${link.purchaseLinkId}`;
  }

  async function handleCopy(id: string, link: PurchaseLinkDoc) {
    await navigator.clipboard.writeText(trackingLink(link));
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  const pageCount = Math.max(1, Math.ceil(links.length / PAGE_SIZE));
  // 削除などで件数が減り、現在のページが無くなった場合は最後のページに戻す
  useEffect(() => {
    if (page >= pageCount) setPage(pageCount - 1);
  }, [page, pageCount]);

  return (
    <main style={ui.pageWide}>
      <div style={ui.headerRow}>
        <h1 style={{ ...ui.h1, margin: 0 }}>広告管理</h1>
        <Link href="/admin/purchase-links/new" style={{ ...ui.buttonPrimary, textDecoration: "none" }}>
          ＋ 新規登録
        </Link>
      </div>

      <div style={ui.tableScroll}>
        <table style={ui.table} className="admin-table">
          <thead>
            <tr>
              <th style={ui.th}>名前</th>
              <th style={{ ...ui.th, textAlign: "right" }}>成果単価</th>
              <th style={ui.th}>遷移先</th>
              <th style={ui.th}>LIFF ID</th>
              <th style={ui.th}>計測リンク</th>
              <th style={ui.th}>登録日時</th>
              <th style={{ ...ui.th, width: 48 }} />
            </tr>
          </thead>
          <tbody>
            {links.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((l) => {
              const isEditing = editingId === l.purchaseLinkId;
              return (
                <Fragment key={l.purchaseLinkId}>
                <tr>
                  <td style={ui.td}>{isEditing ? editPreviewName || <span style={ui.hint}>(未入力)</span> : l.name}</td>
                  <td style={{ ...ui.td, textAlign: "right", whiteSpace: "nowrap" }}>
                    {l.unitPrice !== undefined ? `${l.unitPrice.toLocaleString("ja-JP")}円` : <span style={ui.hint}>未設定</span>}
                  </td>
                  <td style={ui.td}>
                    <a href={l.destinationUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12.5 }}>
                      {l.destinationUrl}
                    </a>
                  </td>
                  <td style={ui.td}>
                    <code style={ui.code}>{l.liffId}</code>
                  </td>
                  <td style={ui.td}>
                    <code style={ui.code}>{trackingLink(l)}</code>
                    <button style={{ ...ui.buttonSmall, marginLeft: 8 }} onClick={() => handleCopy(l.purchaseLinkId, l)}>
                      {copiedId === l.purchaseLinkId ? "コピーしました" : "コピー"}
                    </button>
                  </td>
                  <td style={ui.td}>{new Date(l.createdAt).toLocaleString("ja-JP")}</td>
                  <td style={ui.td}>
                    {isEditing ? (
                      <span style={ui.hint}>編集中</span>
                    ) : (
                      <RowMenu
                        onEdit={() => startEdit(l)}
                        onDuplicate={() => handleDuplicate(l)}
                        onDelete={() => handleDelete(l)}
                      />
                    )}
                  </td>
                </tr>
                {isEditing && (
                  <tr>
                    <td style={{ ...ui.td, background: "#f6f9fb" }} colSpan={7}>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
                          gap: "10px 14px",
                          marginBottom: 12,
                        }}
                      >
                        <label style={{ display: "block", fontSize: 12.5 }}>
                          <span style={{ display: "block", marginBottom: 3 }}>シナリオ(数値)</span>
                          <input
                            type="number"
                            style={{ ...ui.input, width: "100%" }}
                            value={edit.scenarioNumber}
                            onChange={(e) => setEdit((v) => ({ ...v, scenarioNumber: e.target.value }))}
                            autoFocus
                            placeholder="例: 1"
                          />
                        </label>
                        <label style={{ display: "block", fontSize: 12.5 }}>
                          <span style={{ display: "block", marginBottom: 3 }}>通数(数値)</span>
                          <input
                            type="number"
                            style={{ ...ui.input, width: "100%" }}
                            value={edit.messageCount}
                            onChange={(e) => setEdit((v) => ({ ...v, messageCount: e.target.value }))}
                          />
                        </label>
                        <label style={{ display: "block", fontSize: 12.5 }}>
                          <span style={{ display: "block", marginBottom: 3 }}>その他</span>
                          <input
                            style={{ ...ui.input, width: "100%" }}
                            value={edit.other}
                            onChange={(e) => setEdit((v) => ({ ...v, other: e.target.value }))}
                          />
                        </label>
                        <label style={{ display: "block", fontSize: 12.5 }}>
                          <span style={{ display: "block", marginBottom: 3 }}>成果単価(円)</span>
                          <input
                            type="number"
                            min={0}
                            style={{ ...ui.input, width: "100%" }}
                            value={edit.unitPrice}
                            onChange={(e) => setEdit((v) => ({ ...v, unitPrice: e.target.value }))}
                          />
                        </label>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "10px 14px", marginBottom: 12 }}>
                        <label style={{ display: "block", fontSize: 12.5 }}>
                          <span style={{ display: "block", marginBottom: 3 }}>遷移先URL</span>
                          <input
                            style={{ ...ui.input, width: "100%" }}
                            value={edit.destinationUrl}
                            onChange={(e) => setEdit((v) => ({ ...v, destinationUrl: e.target.value }))}
                          />
                        </label>
                        <label style={{ display: "block", fontSize: 12.5 }}>
                          <span style={{ display: "block", marginBottom: 3 }}>LIFF ID</span>
                          <input
                            style={{ ...ui.input, width: "100%" }}
                            value={edit.liffId}
                            onChange={(e) => setEdit((v) => ({ ...v, liffId: e.target.value }))}
                          />
                        </label>
                      </div>
                      <div style={{ fontSize: 12.5, marginBottom: 10 }}>
                        結合後の名前: <strong>{editPreviewName || <span style={ui.hint}>(未入力)</span>}</strong>
                      </div>
                      <button style={ui.buttonSmall} onClick={() => handleUpdate(l.purchaseLinkId)} disabled={busy}>
                        保存
                      </button>
                      <button style={{ ...ui.buttonSmall, marginLeft: 8 }} onClick={cancelEdit}>
                        キャンセル
                      </button>
                    </td>
                  </tr>
                )}
              </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager
        page={page + 1}
        totalPages={pageCount}
        pageSize={PAGE_SIZE}
        hasPrev={page > 0}
        hasNext={page + 1 < pageCount}
        onPrev={() => setPage((p) => p - 1)}
        onNext={() => setPage((p) => p + 1)}
      />
    </main>
  );
}
