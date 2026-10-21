// imp数・CL数インポート用Excelの「シナリオ」列(命名規則付きの名前)と「グループ」列(A/B/-)から、
// ポップアップ別日次レポートで使う「ポップアップ名」を抽出するためのロジック。
//
// 「シナリオ」列の命名規則:
//   【クライアント名｜案件名】設置先｜訴求｜ポップアップA/ポップアップB｜シナリオA/シナリオB｜離脱地点｜中間｜
// (｜は全角パイプ。先頭の【】部分にクライアント名・案件名が入り、以降｜区切りで6項目が続く)
//
// ポップアップ・シナリオの項目は、A/Bの出し分けがある場合は「ポップアップA/ポップアップB」のように
// "/"区切りで2つ書かれており、その行の「グループ」列(A または B)で該当する側を選ぶ。
// 一方、A/Bの出し分けがなく単一の値しか書かれていない場合("/"を含まない)は、
// グループ列の値に関わらずそのままの値をポップアップ名として使う。

const BRACKET_PREFIX = /^【[^】]*】/;

// "ポップアップA/ポップアップB" のような"/"区切りの項目から、グループ("A"/"B"/"-"等)に応じて
// 該当する側の値を選ぶ。"/"を含まない(A/Bの出し分けがない)場合は、グループに関わらずそのまま返す。
function pickByGroup(field: string, group: string): string | null {
  const trimmed = field.trim();
  if (!trimmed) return null;
  const options = trimmed
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  if (options.length <= 1) return options[0] ?? null;
  if (group.trim() === "B") return options[1] ?? options[0];
  // "A"の場合、および("-"など)判定できない場合はAを既定値として扱う
  return options[0];
}

// ｜(全角パイプ)区切り後の項目インデックス: [設置先, 訴求, ポップアップ, シナリオ, 離脱地点, 中間, (末尾の空要素)]
function splitFields(scenarioName: string): string[] | null {
  const withoutClient = scenarioName.trim().replace(BRACKET_PREFIX, "");
  if (!withoutClient) return null;
  return withoutClient.split("｜").map((s) => s.trim());
}

// 「シナリオ」列の値(命名規則に沿ったフルネーム)と「グループ」列の値から、
// 流入経路の「訴求」構成要素にあたる値を抽出する(命名規則上の2項目め)。
// 命名規則に沿わない・項目が読み取れない場合はnullを返す。
export function extractAppealFromScenarioName(scenarioName: string, group: string): string | null {
  const parts = splitFields(scenarioName);
  const appealField = parts?.[1];
  if (!appealField) return null;
  return pickByGroup(appealField, group);
}

// 「シナリオ」列の値(命名規則に沿ったフルネーム)と「グループ」列の値から、ポップアップ名を抽出する。
// 命名規則に沿わない・項目が読み取れない場合はnullを返す(呼び出し側で「(未設定)」等にフォールバックする)。
export function extractPopupFromScenarioName(scenarioName: string, group: string): string | null {
  const parts = splitFields(scenarioName);
  const popupField = parts?.[2];
  if (!popupField) return null;
  return pickByGroup(popupField, group);
}

// 「シナリオ」列の値(命名規則に沿ったフルネーム)と「グループ」列の値から、
// 流入経路の「シナリオ」構成要素にあたる値を抽出する(命名規則上の4項目め)。
// 命名規則に沿わない・項目が読み取れない場合はnullを返す。
export function extractScenarioFromScenarioName(scenarioName: string, group: string): string | null {
  const parts = splitFields(scenarioName);
  const scenarioField = parts?.[3];
  if (!scenarioField) return null;
  return pickByGroup(scenarioField, group);
}

// 「シナリオ」列の値(命名規則に沿ったフルネーム)と「グループ」列の値から、
// 流入経路の「離脱地点」構成要素にあたる値を抽出する(命名規則上の5項目め)。
// 命名規則に沿わない・項目が読み取れない場合はnullを返す。
export function extractExitPointFromScenarioName(scenarioName: string, group: string): string | null {
  const parts = splitFields(scenarioName);
  const exitPointField = parts?.[4];
  if (!exitPointField) return null;
  return pickByGroup(exitPointField, group);
}

// 「シナリオ」列の値(命名規則に沿ったフルネーム)と「グループ」列の値から、
// 流入経路の名前(設置先・訴求・ポップアップ・シナリオ・離脱地点・中間ページの6要素を「_」区切りで結合したもの)を組み立てる。
// 流入経路管理のbuildSourceName()(src/lib/source-name.ts)と同じ並び・同じ区切りのため、sources.nameと突き合わせられる。
// A/Bの出し分けがある要素は、グループ列に応じて該当する側を選ぶ。6要素がすべて読み取れない場合はnullを返す。
export function extractSourceNameFromScenarioName(scenarioName: string, group: string): string | null {
  const parts = splitFields(scenarioName);
  if (!parts) return null;
  const segments = [0, 1, 2, 3, 4, 5]
    .map((i) => (parts[i] ? pickByGroup(parts[i], group) : null))
    .filter((s): s is string => !!s);
  return segments.length > 0 ? segments.join("_") : null;
}

// 「シナリオ」列の値とグループ列の値から、ポップアップ×シナリオ別月次レポートのラベル「ポップアップ / シナリオ」を組み立てる
// (getPopupScenarioLabelMap()と同じ形式)。どちらか一方が読み取れない場合はその側を「(未設定)」とし、両方読み取れない場合はnullを返す。
export function extractPopupScenarioLabelFromScenarioName(scenarioName: string, group: string): string | null {
  const popup = extractPopupFromScenarioName(scenarioName, group);
  const scenario = extractScenarioFromScenarioName(scenarioName, group);
  if (!popup && !scenario) return null;
  return `${popup ?? "(未設定)"} / ${scenario ?? "(未設定)"}`;
}
