// 流入経路(SourceDoc)の「名前」を、複数の構成要素から組み立てるための共通ロジック。
// 一覧画面・APIの両方(新規登録・更新)から同じロジックを使うことで、組み立て方がずれないようにする。

export type SourceNameParts = {
  placement?: string; // 設置先
  appeal?: string; // 訴求
  popup?: string; // ポップアップ
  scenario?: string; // シナリオ
  exitPoint?: string; // 離脱地点
  intermediatePage?: string; // 中間ページ
  other?: string; // その他
};

// 空欄の要素をスキップしつつ、決まった順序で「_」区切りに結合する。
export function buildSourceName(parts: SourceNameParts): string {
  const segments = [
    parts.placement?.trim(),
    parts.appeal?.trim(),
    parts.popup?.trim(),
    parts.scenario?.trim(),
    parts.exitPoint?.trim(),
    parts.intermediatePage?.trim(),
    parts.other?.trim(),
  ].filter((s): s is string => !!s);

  return segments.join("_");
}
