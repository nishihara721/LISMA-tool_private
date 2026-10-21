// マニュアルを、管理画面とは独立した静的サイト(HTMLファイル群)として書き出すスクリプト。
// 内容は src/app/admin/manual/content.ts(管理画面内のマニュアルページと共通)から読み込む。
// 親メニュー(グループ)ごとにディレクトリを分け、小項目(セクション)ごとに1ページ(<グループID>/<項目ID>.html)、
// 加えて全体の目次ページ(index.html)と、グループごとの目次ページ(<グループID>/index.html)を生成する。
//
// 使い方:
//   node scripts/build-manual-site.js [--out manual-site]
// 管理画面へのリンクは出さない(マニュアルは管理画面とは別ドメインで公開するため)。
// 出力先フォルダ(既定: manual-site)の中身をそのままWebサーバー(静的ホスティング)にアップロードすれば公開できる。
// リンクはすべて相対パスのため、サブフォルダ配下に置いても動作する。
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}
const outDir = path.resolve(process.cwd(), argValue("--out", "manual-site"));

// content.ts(TypeScript)をその場でJavaScriptに変換して読み込む
const contentPath = path.resolve(__dirname, "../src/app/admin/manual/content.ts");
const compiled = ts.transpileModule(fs.readFileSync(contentPath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const mod = { exports: {} };
new Function("module", "exports", compiled)(mod, mod.exports);
const GROUPS = mod.exports.MANUAL_GROUPS;

const SITE_TITLE = "LINE友だち管理ツール マニュアル";

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const allSections = GROUPS.flatMap((g) => g.sections.map((s) => ({ ...s, group: g })));

// サイドメニューは各ページに埋め込まず、menu.js(1ファイル)にまとめる。
// 各ページには空の <nav data-manual-nav> を置き、menu.js が読み込み時にメニューを描画する。
// 現在のページの強調表示もmenu.jsが行う(ページ側にメニューの記述は持たない)。
function menuScript() {
  const data = GROUPS.map((g) => ({
    id: g.id,
    title: g.title,
    sections: g.sections.map((s) => ({ id: s.id, title: s.title })),
  }));
  return `// サイドメニュー(全ページ共通)。build-manual-site.js が自動生成するため、直接編集しないこと。
(function () {
  var GROUPS = ${JSON.stringify(data)};
  var script = document.currentScript;
  var base = (script && script.getAttribute("data-base")) || "";
  var here = location.pathname.replace(/\\/$/, "/index.html");
  function esc(t) {
    return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function isCurrent(href) {
    var path = new URL(href, location.href).pathname;
    return path === here || path === here.replace(/index\\.html$/, "");
  }
  var html = GROUPS.map(function (g) {
    var links = g.sections.map(function (s) {
      var href = base + g.id + "/" + s.id + ".html";
      var cur = isCurrent(href);
      return '<a href="' + href + '" class="nav-link' + (cur ? " current" : "") + '"' + (cur ? ' aria-current="page"' : "") + ">" + esc(s.title) + "</a>";
    }).join("");
    return '<div class="nav-group"><div class="nav-group-title"><a href="' + base + g.id + '/index.html">' + esc(g.title) + "</a></div>" + links + "</div>";
  }).join("");
  document.querySelectorAll("[data-manual-nav]").forEach(function (el) { el.innerHTML = html; });
})();
`;
}

function layout({ title, body, base }) {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<link rel="stylesheet" href="${base}style.css">
</head>
<body>
<header class="site-header">
  <a href="${base}index.html" class="site-title">${esc(SITE_TITLE)}</a>
</header>
<div class="wrap">
  <details class="nav-toggle">
    <summary>メニュー</summary>
    <nav class="sidebar" data-manual-nav><a href="${base}index.html">目次</a></nav>
  </details>
  <nav class="sidebar sidebar-desktop" data-manual-nav><a href="${base}index.html">目次</a></nav>
  <main class="content">
${body}
  </main>
</div>
<footer class="site-footer">${esc(SITE_TITLE)}</footer>
<script src="${base}menu.js" data-base="${base}"></script>
</body>
</html>
`;
}

// グループのディレクトリ内のページから見た、他の小項目ページへの相対パス
function pageHref(section) {
  return `../${section.group.id}/${section.id}.html`;
}

function sectionPage(section, index) {
  const prev = allSections[index - 1];
  const next = allSections[index + 1];
  const parts = [];
  parts.push(`<p class="breadcrumb"><a href="../index.html">目次</a> &gt; <a href="index.html">${esc(section.group.title)}</a></p>`);
  parts.push(`<h1>${esc(section.title)}</h1>`);
  parts.push(`<p class="summary">${esc(section.summary)}</p>`);
  if (section.steps && section.steps.length) {
    parts.push(`<h2>使い方</h2>\n<ol>\n${section.steps.map((t) => `<li>${esc(t)}</li>`).join("\n")}\n</ol>`);
  }
  if (section.notes && section.notes.length) {
    parts.push(`<h2 class="note-title">補足・注意点</h2>\n<ul class="notes">\n${section.notes.map((t) => `<li>${esc(t)}</li>`).join("\n")}\n</ul>`);
  }
  parts.push(`<div class="pager">
  ${prev ? `<a class="prev" href="${pageHref(prev)}"><span>前へ</span>${esc(prev.title)}</a>` : "<span></span>"}
  ${next ? `<a class="next" href="${pageHref(next)}"><span>次へ</span>${esc(next.title)}</a>` : "<span></span>"}
</div>`);
  return layout({ title: `${section.title} | ${SITE_TITLE}`, body: parts.join("\n"), base: "../" });
}

function indexPage() {
  const body = [
    `<h1>${esc(SITE_TITLE)}</h1>`,
    `<p class="summary">LINE友だち管理ツールの各画面の説明と使い方をまとめたマニュアルです。見たい画面を下の一覧から選んでください。</p>`,
    ...GROUPS.map(
      (g) => `<section class="index-group">
  <h2><a href="${g.id}/index.html">${esc(g.title)}</a></h2>
  <ul class="index-list">
${g.sections
  .map((s) => `    <li><a href="${g.id}/${s.id}.html"><strong>${esc(s.title)}</strong><span>${esc(s.summary)}</span></a></li>`)
  .join("\n")}
  </ul>
</section>`
    ),
  ].join("\n");
  return layout({ title: SITE_TITLE, body, base: "" });
}

// グループごとの目次ページ(<グループID>/index.html)
function groupPage(g) {
  const body = [
    `<p class="breadcrumb"><a href="../index.html">目次</a></p>`,
    `<h1>${esc(g.title)}</h1>`,
    `<ul class="index-list">
${g.sections
  .map((s) => `  <li><a href="${s.id}.html"><strong>${esc(s.title)}</strong><span>${esc(s.summary)}</span></a></li>`)
  .join("\n")}
</ul>`,
  ].join("\n");
  return layout({ title: `${g.title} | ${SITE_TITLE}`, body, base: "../" });
}

const CSS = `*{box-sizing:border-box}
:root{--bg:#f6f8fa;--card:#fff;--text:#1f2933;--muted:#5f6b76;--line:#e1e6eb;--accent:#2f7fa8;--accent-bg:#e8f2f8}
body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic",Meiryo,sans-serif;line-height:1.8;font-size:15px}
a{color:var(--accent)}
.site-header{background:#fff;border-bottom:1px solid var(--line);padding:14px 20px;position:sticky;top:0;z-index:10}
.site-title{font-weight:700;font-size:16px;color:var(--text);text-decoration:none}
.wrap{display:flex;gap:32px;max-width:1100px;margin:0 auto;padding:24px 20px 48px;align-items:flex-start}
.sidebar{width:260px;flex-shrink:0;font-size:13.5px}
.sidebar-desktop{position:sticky;top:76px;max-height:calc(100vh - 96px);overflow-y:auto}
.nav-toggle{display:none;width:100%;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 12px}
.nav-toggle summary{cursor:pointer;font-weight:700}
.nav-toggle .sidebar{width:auto;margin-top:8px}
.nav-group{margin-bottom:14px}
.nav-group-title{font-weight:700;margin-bottom:2px}
.nav-group-title a{color:var(--text);text-decoration:none}
.nav-group-title a:hover{color:var(--accent)}
.index-group h2 a{color:var(--text);text-decoration:none}
.nav-link{display:block;padding:3px 10px;border-radius:6px;color:var(--text);text-decoration:none;line-height:1.6}
.nav-link:hover{background:var(--accent-bg)}
.nav-link.current{background:var(--accent-bg);color:var(--accent);font-weight:700}
.content{flex:1;min-width:0;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:28px 32px}
.breadcrumb{margin:0 0 6px;font-size:12.5px;color:var(--muted)}
h1{font-size:22px;line-height:1.5;margin:0 0 14px}
/* 機能ごとの見出し(h2)。2つ目以降の機能は上に区切り線を入れて、機能ごとのまとまりを分かりやすくする */
h2{font-size:17px;line-height:1.5;margin:40px 0 12px;padding:2px 0 2px 12px;border-left:5px solid var(--accent)}
/* 機能内の小見出し(h3) */
h3{font-size:15px;line-height:1.5;margin:24px 0 8px;padding-bottom:4px;border-bottom:1px dashed var(--line)}
h3::before{content:"";display:inline-block;width:8px;height:8px;margin-right:8px;border-radius:2px;background:var(--accent);vertical-align:1px}
.summary{margin:0 0 6px}
.content p{margin:8px 0}
.open-link{margin:0 0 10px;font-size:13.5px}
ol,ul{padding-left:24px;margin:8px 0}
li{margin:6px 0}
/* 手順(番号付きリスト)。番号をアクセントカラーで目立たせる */
ol{list-style:none;counter-reset:step;padding-left:0}
ol>li{counter-increment:step;position:relative;padding:8px 12px 8px 44px;margin:6px 0;background:#fafcfd;border:1px solid var(--line);border-radius:8px}
ol>li::before{content:counter(step);position:absolute;left:12px;top:8px;width:22px;height:22px;border-radius:50%;background:var(--accent);color:#fff;font-size:12.5px;font-weight:700;line-height:22px;text-align:center}
/* 補足・注意点: <h2 class="note-title">補足・注意点</h2> の直後の <ul class="notes"> を、見出しと一体の注意書きボックスにする。
   (class="note-title" を付けない h2 は、通常の機能見出しとして表示される) */
h2.note-title{margin:22px 0 0;padding:8px 14px;font-size:14px;border-left:none;border-radius:8px 8px 0 0;background:#fff4e0;border:1px solid #f0d9a8;border-bottom:none;color:#8a5a00}
h2.note-title::before{content:"\\26A0\\FE0E";margin-right:8px}
/* アイコンの切り替え: class="note-title icon-exclaim" で、オレンジの丸に「!」のアイコンになる(既定は三角の警告マーク) */
h2.note-title.icon-exclaim::before{content:"!";display:inline-block;width:20px;height:20px;margin-right:8px;border-radius:50%;background:#e8960c;color:#fff;font-size:13px;font-weight:700;line-height:20px;text-align:center;vertical-align:1px}
h2.note-title+ul.notes{margin:0 0 8px;padding:10px 16px 10px 34px;background:#fffaf0;border:1px solid #f0d9a8;border-radius:0 0 8px 8px}
ul.notes>li{margin:6px 0}
/* li内の表(項目名と意味の一覧など) */
li table,.content table{width:100%;border-collapse:collapse;margin:10px 0 6px;font-size:13.5px;line-height:1.6;background:#fff}
li table th,li table td,.content table th,.content table td{border:1px solid var(--line);padding:7px 12px;text-align:left;vertical-align:top}
li table thead th,.content table thead th{background:var(--accent-bg);color:#1f4f69;font-weight:700;white-space:nowrap}
li table tbody th,li table tbody td:first-child,.content table tbody th,.content table tbody td:first-child{background:#f6f9fb;font-weight:600;white-space:nowrap;width:1%}
li table tbody tr:hover td,.content table tbody tr:hover td{background:#fbfdfe}
li table tbody tr:hover td:first-child,.content table tbody tr:hover td:first-child{background:#f1f6f9}
/* エラー・システムログの一覧など、1項目ずつ「意味」「解決方法」を並べるカード */
.log-item{margin:12px 0;border:1px solid var(--line);border-radius:10px;background:#fff;overflow:hidden}
.log-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:9px 14px;background:#f3f7f9;border-bottom:1px solid var(--line)}
.log-stage{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13.5px;font-weight:700;color:#1f4f69;word-break:break-all}
.log-level{display:inline-block;padding:1px 9px;border-radius:999px;font-size:11.5px;font-weight:700;line-height:1.7;color:#fff}
.log-level-error{background:#d6453d}
.log-level-warn{background:#e8960c}
.log-level-info{background:#6b7f87}
.log-body{margin:0;padding:10px 14px 12px;display:grid;grid-template-columns:6.5em 1fr;gap:6px 12px;font-size:14px;line-height:1.7}
.log-body dt{font-weight:700;color:var(--muted);font-size:12.5px;padding-top:2px}
.log-body dd{margin:0}
.pager{display:flex;justify-content:space-between;gap:12px;margin-top:36px;padding-top:16px;border-top:1px solid var(--line)}
.pager a{display:block;max-width:48%;padding:10px 14px;border:1px solid var(--line);border-radius:8px;text-decoration:none;font-size:13.5px;line-height:1.5}
.pager a:hover{background:var(--accent-bg)}
.pager a span{display:block;font-size:11.5px;color:var(--muted)}
.pager .next{text-align:right;margin-left:auto}
.index-group{margin-top:28px}
.index-list{list-style:none;padding:0;margin:8px 0;display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.index-list li{margin:0}
.index-list a{display:block;height:100%;padding:12px 14px;border:1px solid var(--line);border-radius:8px;text-decoration:none;color:var(--text);line-height:1.6}
.index-list a:hover{background:var(--accent-bg)}
.index-list strong{display:block;color:var(--accent);font-size:14px}
.index-list span{display:block;font-size:12.5px;color:var(--muted);margin-top:2px}
.site-footer{text-align:center;color:var(--muted);font-size:12px;padding:20px}
@media (max-width:820px){
  .wrap{display:block;padding:14px 12px 40px}
  .sidebar-desktop{display:none}
  .nav-toggle{display:block;margin-bottom:14px}
  .content{padding:20px 16px}
  .index-list{grid-template-columns:1fr}
  li table,.content table{display:block;overflow-x:auto}
  .log-body{grid-template-columns:1fr;gap:2px}
  .log-body dd{margin-bottom:8px}
  ol>li{padding-left:40px}
}
`;

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "style.css"), CSS);
fs.writeFileSync(path.join(outDir, "menu.js"), menuScript());
fs.writeFileSync(path.join(outDir, "index.html"), indexPage());
GROUPS.forEach((g) => {
  fs.mkdirSync(path.join(outDir, g.id), { recursive: true });
  fs.writeFileSync(path.join(outDir, g.id, "index.html"), groupPage(g));
});
allSections.forEach((s, i) => fs.writeFileSync(path.join(outDir, s.group.id, `${s.id}.html`), sectionPage(s, i)));
fs.writeFileSync(
  path.join(outDir, "README.txt"),
  `このフォルダの中身(index.html、親メニューごとのフォルダ、style.css、menu.js)を、そのままWebサーバーにアップロードしてください。
内容の更新は src/app/admin/manual/content.ts を編集し、プロジェクトのフォルダで
  node scripts/build-manual-site.js
を実行すると、このフォルダが作り直されます。
`
);
console.log(`${allSections.length + GROUPS.length + 1}ページを ${outDir} に書き出しました`);
