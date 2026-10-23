// Firestore コレクション: sources
// 流入経路(広告・SNS・LP等)のマスタ
//
// nameは表示・検索・他コレクションからの参照に使う「結合済みの名前」で、常にサーバー側で
// 以下の構成要素(すべて任意項目)から自動生成される(空欄の要素は結合時にスキップする)。
// 既存データ(この項目が追加される前に登録されたもの)は構成要素を持たず、nameだけの状態になる。
export type SourceDoc = {
  sourceId: string;
  name: string; // 例: "LP上部_夏セール訴求_ポップアップA_シナリオ1_離脱ポイントA_中間ページ2"(各要素を「_」で結合したもの)
  placement?: string; // 設置先
  appeal?: string; // 訴求
  popup?: string; // ポップアップ
  scenario?: string; // シナリオ
  exitPoint?: string; // 離脱地点
  intermediatePage?: string; // 中間ページ
  other?: string; // その他(上記に当てはまらない要素の自由入力。既存データの移行先としても使う)
  lstepUrl?: string; // この流入経路専用のLステップ流入経路リンク(設定時、友だち追加リンクのリダイレクト先をここに差し替える)
  createdAt: number;
};

// Firestore コレクション: clicks
// 友だち追加リンク・広告のクリックログ
export type ClickDoc = {
  clickId: string;
  linkType: "add_friend" | "purchase";
  sourceId: string; // add_friend の場合の流入経路
  userId?: string; // LIFF経由で取得できた場合のみ。取得前はnull
  purchaseLinkId?: string; // linkType が purchase の場合に紐づく PurchaseLink の ID
  clickedAt: number;
  userAgent?: string;
  // このクリックの時点での、友だちの「追加時の流入経路」「最新の流入経路」のスナップショット。
  // (友だち一覧・友だちドキュメント自体は後から最新の流入経路が更新され続けるため、
  //  クリックログでは記録した時点の値のまま変わらないよう、ここに複製して固定している)
  // add_friendリンクのクリックの場合はこのクリックによる更新後の値、purchaseリンクのクリックの場合は
  // クリック時点で友だちドキュメントに入っていた値をそのまま複製する。
  // ユーザーが未特定だった場合や、この項目が追加される前の古いクリック記録には存在しない。
  friendSourceIdAtClick?: string;
  friendLatestSourceIdAtClick?: string;
  // クリックした流入経路の名前(sources.name)のスナップショット。後から流入経路の名前を編集・削除しても、
  // クリックログの表示が変わらないよう記録時点の名前を固定している。この項目が追加される前の古い記録には存在しない。
  sourceNameAtClick?: string;
  // 友だち追加リンク(add_friend)のクリック時点での、そのユーザーの状態のスナップショット。
  // 後から友だち追加・ブロック等で状態が変わっても、クリックログの「状態」は変わらないよう固定している。
  // この項目が追加される前の古い記録には存在しない。
  // "registered" = ツール導入前から友だちだった人が初めてリンクを踏み、このクリックで友だちとして自動登録された
  statusAtClick?: "unidentified" | "not_added" | "existing" | "unblocked" | "registered";
};

// Firestore コレクション: friends
// 友だち追加された LINE ユーザー
export type FriendDoc = {
  userId: string; // LINEのuserId
  displayName?: string;
  pictureUrl?: string;
  sourceId: string; // 友だち追加時(ファーストタッチ)の流入経路。追加後は基本的に上書きしない
  sourceClickId?: string; // 追加直前に踏んだ clickId(逆引き用)
  latestSourceId?: string; // 友だち追加後に流入経路リンクを再クリックした場合の、直近(最新)の流入経路
  latestSourceClickId?: string; // 直近の再クリックのclickId
  addedAt: number;
  unfollowedAt?: number | null;
  idNumber?: number; // 友だち追加日時が古い順の連番。友だち追加時に自動採番する(counters/friendIdNumberで管理)
  lstepNumber?: string; // LステップのCSVインポートで付与する、Lステップ側の管理番号
  // true = ツール導入前から友だちだった人(流入経路リンクのクリックで自動登録したもの)。友だち一覧の「導入前」列に表示する。
  // このフラグが付いた友だちは、LステップのCSVで追加日時・流入経路を何度でも修正できる。
  preExisting?: boolean;
  // true = 導入前の友だちの追加日時がまだ確定していない(addedAtは「初めてリンクを踏んだ日時」で代用している)。
  // LステップのCSVで追加日時を更新すると削除される。日ごとの集計(daily_stats)・レポートには、確定するまで含めない。
  addedAtEstimated?: boolean;
};

// Firestore コレクション: counters
// 連番採番用のカウンタードキュメント
export type FriendIdCounterDoc = {
  value: number; // 直近に採番したID
};

// Firestore コレクション: purchase_links
// 購入導線として発行するLIFFリンクのマスタ
//
// nameは表示・検索・他コレクションからの参照に使う「結合済みの名前」で、常にサーバー側で
// 以下の構成要素(すべて任意項目)から自動生成される(空欄の要素は結合時にスキップする)。
// 既存データ(この項目が追加される前に登録されたもの)は構成要素を持たず、nameだけの状態になる。
export type PurchaseLinkDoc = {
  purchaseLinkId: string;
  name: string; // 例: "シナリオ1_500通"(各要素を「_」で結合したもの)
  scenario?: string; // シナリオ
  messageCount?: number; // 通数
  other?: string; // その他(上記に当てはまらない要素の自由入力。既存データの移行先としても使う)
  unitPrice?: number; // 成果単価(円)。レポートの「請求額」は、この広告の成果1件あたりこの金額として集計する。未設定は0円扱い
  destinationUrl: string; // 参考表示用。実際の遷移はLIFFのエンドポイントURL設定によって行われる
  liffId: string; // destinationUrlのページを「エンドポイントURL」として登録したLIFFアプリのID
  createdAt: number;
};

// Firestore コレクション: conversions
// 購入(成果)ログ
export type ConversionDoc = {
  conversionId: string;
  userId?: string; // クリック時点・LP/サンクスページでのバックグラウンド特定のいずれでも判明しなかった場合はundefined
  sourceId: string; // その友だちの追加時(ファーストタッチ)の流入経路(friends.sourceIdを複製して分析しやすくする)。未特定の場合は"unknown"
  latestSourceId?: string; // 成果時点での、その友だちの直近(最新)の流入経路(friends.latestSourceIdを複製)
  purchaseLinkId: string;
  clickId: string; // この成果の直接のきっかけになったclicksドキュメントのID
  amount?: number;
  convertedAt: number;
};

// Firestore コレクション: event_logs
// 友だち追加・流入経路リンククリック・成果計測の各過程で発生した、注意すべき事象・エラーの記録。
// (正常に完了したクリック・友だち追加・成果自体は clicks/friends/conversions に記録されるため、
//  ここには「通常と異なること(警告・エラー)が起きた」場合のみを記録し、ログを見やすく保つ)
export type LogLevel = "info" | "warn" | "error";

export type EventLogDoc = {
  logId: string;
  level: LogLevel;
  stage: string; // 発生した処理を表す識別子(例: "liff_add.client_error", "track_click.id_token_verify_failed" 等)
  message: string; // 日本語の説明
  context?: Record<string, unknown>; // userId, sourceId, clickId, purchaseLinkId, エラー詳細など
  createdAt: number;
};

// Firestore コレクション: report_cv_entries
// 日次レポート・編集用成果ログ画面のための「上書き情報」を持つコレクション。
// conversions コレクション自体(自動計測の記録)は書き換えず、以下の2種類の情報だけをここに持たせる。
//
// 1. kind: "auto"  … 既存のconversionsドキュメント(id = conversionId)を日次レポートの
//                    集計から除外(非表示)したい場合にだけ、ドキュメントを作成する。
//                    (表示する場合は何もしない = ドキュメント自体が存在しない状態が「表示」のデフォルト)
// 2. kind: "import" … CSV等で手動追加した成果。conversionsには対応する記録がなく、これ自体が成果の実体になる。
//
// どちらの種類も hidden フラグを持ち、trueの場合は日次レポートの集計・編集用成果ログ画面の
// 「表示中」リストには出てこず、「非表示」マークとともに一覧には残る(完全に削除はしない)。
export type ReportCvEntryDoc = {
  id: string; // kind="auto"の場合はconversions.conversionIdと同じ値、kind="import"の場合は新規発行するID
  kind: "auto" | "import";
  hidden: boolean;
  convertedAt: number; // kind="import"の場合は入力された成果日時。kind="auto"の場合も集計クエリを単純にするため複製して持たせる
  note?: string; // 任意メモ(CSV由来の備考など)
  sourceName?: string; // kind="import"の場合、任意で入力された流入経路名(自由入力のテキストとして扱う)
  purchaseLinkName?: string; // kind="import"の場合、任意で入力された広告名(自由入力のテキストとして扱う)
  createdAt: number;
  updatedAt: number;
};

// Firestore コレクション: daily_ad_metrics
// 日次レポートに表示する、広告・ポップアップ関連の指標(PV数・imp数・CL数)。
// このツール自体が計測しているものではなく、Flipdesk等の管理画面からエクスポートしたCSVを
// インポートして記録する。ドキュメントID・日付キーは "YYYY-MM-DD"(日本時間)。
//
// PV数・imp数・CL数はそれぞれ別のタイミングでインポートされる可能性があるため、
// インポート時は該当するフィールドだけを上書きする(他のフィールドは保持する)。
export type DailyAdMetricsDoc = {
  date: string; // YYYY-MM-DD (日本時間)
  pvCount?: number; // ページビュー数(別のCSVインポートで設定予定。現時点では未実装)
  impCount?: number; // 自動ポップアップ表示回数の合計(その日の全シナリオ分を合算)
  clCount?: number; // ポップアップ内のクリック数の合計(その日の全シナリオ分を合算)
  memo?: string; // 日次レポート画面の「メモ」欄(管理者が画面から入力。URLは「表示名(URL)」の書き方でリンクにできる)
  updatedAt: number;
};

// ポップアップ別日次レポート用のimp数・CL数。DailyAdMetricsDocとは別コレクションで、
// 日付だけでなくポップアップ単位でも集計する(ドキュメントIDは`${date}__${popup}`)。
// ポップアップ名は、インポート元CSVの「シナリオ」列(構成要素をまとめた名前)と「グループ」列(A/B/-)から
// src/lib/scenario-popup.ts の extractPopupFromScenarioName() で抽出したもの。
export type DailyPopupAdMetricsDoc = {
  date: string; // YYYY-MM-DD (日本時間)
  popup: string;
  pvCount?: number; // そのポップアップのPV数(CSV取り込み、または画面からの手動入力・修正で設定)
  impCount?: number; // 自動ポップアップ表示回数の合計(その日・そのポップアップの全シナリオ分を合算)
  clCount?: number; // ポップアップ内のクリック数の合計(その日・そのポップアップの全シナリオ分を合算)
  updatedAt: number;
};

// シナリオ別日次レポート用のimp数・CL数。DailyPopupAdMetricsDocと同じ考え方で、
// 日付だけでなくシナリオ単位でも集計する(ドキュメントIDは`${date}__${scenario}`)。
// シナリオ名は、インポート元CSVの「シナリオ」列(構成要素をまとめた名前)と「グループ」列(A/B/-)から
// src/lib/scenario-popup.ts の extractScenarioFromScenarioName() で抽出したもの
// (流入経路の「シナリオ」構成要素の値であり、命名規則の元になった「シナリオ」列自体とは別物)。
export type DailyScenarioAdMetricsDoc = {
  date: string; // YYYY-MM-DD (日本時間)
  scenario: string;
  pvCount?: number; // そのシナリオのPV数(画面からの手動入力・修正で設定)
  impCount?: number;
  clCount?: number;
  updatedAt: number;
};

// 離脱地点別日次レポート用のimp数・CL数。DailyPopupAdMetricsDoc・DailyScenarioAdMetricsDocと同じ考え方で、
// 日付だけでなく離脱地点単位でも集計する(ドキュメントIDは`${date}__${exitPoint}`)。
// 離脱地点名は、インポート元CSVの「シナリオ」列(構成要素をまとめた名前)と「グループ」列(A/B/-)から
// src/lib/scenario-popup.ts の extractExitPointFromScenarioName() で抽出したもの。
export type DailyExitPointAdMetricsDoc = {
  date: string; // YYYY-MM-DD (日本時間)
  exitPoint: string;
  pvCount?: number; // その離脱地点のPV数(CSV取り込み、または画面からの手動入力・修正で設定)
  impCount?: number;
  clCount?: number;
  updatedAt: number;
};

// 訴求別日次レポート用のimp数・CL数。DailyPopupAdMetricsDoc等と同じ考え方で、
// 日付だけでなく訴求単位でも集計する(ドキュメントIDは`${date}__${appeal}`)。
// 訴求名は、インポート元CSVの「シナリオ」列(構成要素をまとめた名前)と「グループ」列(A/B/-)から
// src/lib/scenario-popup.ts の extractAppealFromScenarioName() で抽出したもの。
export type DailyAppealAdMetricsDoc = {
  date: string; // YYYY-MM-DD (日本時間)
  appeal: string;
  pvCount?: number; // その訴求のPV数(訴求ごとの列を持つCSVの取り込み、または画面からの手動入力・修正で設定)
  impCount?: number;
  clCount?: number;
  updatedAt: number;
};

// 設置先×訴求×離脱地点×ポップアップ×シナリオ×中間別月次レポート用のimp数・CL数。
// DailyPopupAdMetricsDoc等と同じ考え方で、日付×「流入経路の名前」単位で集計する(ドキュメントIDは`${date}__${sourceName}`)。
// 流入経路の名前(sourceName)は、インポート元CSVの「シナリオ」列(命名規則付きの名前)と「グループ」列(A/B/-)から
// src/lib/scenario-popup.ts の extractSourceNameFromScenarioName() で6要素を取り出し、
// src/lib/source-name.ts の buildSourceName() と同じ「_」区切りで結合したもの(sources.nameと突き合わせられる)。
// この組み合わせ単位のPV数は取り込み元が無いため持たない(月次レポートでは日次の合計PV数を使う)。
export type DailySourceAdMetricsDoc = {
  date: string; // YYYY-MM-DD (日本時間)
  sourceName: string;
  impCount?: number;
  clCount?: number;
  updatedAt: number;
};

// ポップアップ×シナリオ別月次レポート用のimp数・CL数。日付×「ポップアップ / シナリオ」のラベル単位で集計する
// (ドキュメントIDは`${date}__${label}`)。ラベルは、インポート元CSVの「シナリオ」列(命名規則付きの名前)と
// 「グループ」列(A/B/-)から src/lib/scenario-popup.ts の extractPopupScenarioLabelFromScenarioName() で作る
// (getPopupScenarioLabelMap()と同じ「ポップアップ / シナリオ」形式。どちらかが読み取れない側は「(未設定)」)。
// この組み合わせ単位のPV数は取り込み元が無いため持たない(月次レポートでは日次の合計PV数を使う)。
export type DailyPopupScenarioAdMetricsDoc = {
  date: string; // YYYY-MM-DD (日本時間)
  label: string;
  impCount?: number;
  clCount?: number;
  updatedAt: number;
};

// Firestore コレクション: admin_users
// 管理画面にログインできるアカウント。ロールは2種類のみ:
//   - admin: 管理者権限。全ページの閲覧・編集が可能(allowedPagesは使用しない)。
//   - report_viewer: レポート閲覧権限。allowedPagesに指定したページのみ閲覧可能。
export type AdminUserDoc = {
  userId: string;
  loginId: string; // ログインID(英数字等。重複不可)
  passwordHash: string; // src/lib/password.ts の hashPassword() で生成した "salt:hash" 形式
  displayName: string;
  role: "admin" | "report_viewer";
  // role が report_viewer の場合のみ使用。src/lib/admin-pages.ts の ADMIN_PAGES の path の配列。
  allowedPages?: string[];
  createdAt: number;
  updatedAt: number;
};
