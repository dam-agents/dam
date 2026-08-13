import type { ArtifactKind } from "api-server-api";
import { extensionOf } from "../domain/artifact-kind.js";

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function jsStringLiteral(s: string): string {
  return JSON.stringify(s).replaceAll("<", "\\u003c");
}

function templateLiteralEscape(s: string): string {
  return s
    .replaceAll("\\", "\\\\")
    .replaceAll("`", "\\`")
    .replaceAll("$", "\\$");
}

const CHROME_CSS = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; margin: 0; }
  body { font-family: system-ui, -apple-system, sans-serif; background: #fafaf9; color: #121619; }
  @media (prefers-color-scheme: dark) { body { background: #0c0a09; color: #fafaf9; } }
  .center-card { min-height: 100dvh; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .card { max-width: 420px; width: 100%; background: light-dark(#fff, #161616); border: 1px solid light-dark(#dde1e6, #393939); border-radius: 12px; padding: 32px; text-align: center; }
  .card h1 { font-size: 20px; margin-bottom: 8px; }
  .card p { font-size: 14px; color: light-dark(#57534e, #a8a29e); margin-bottom: 16px; }
  .card input { width: 100%; height: 40px; padding: 0 12px; border-radius: 6px; border: 1px solid light-dark(#dde1e6, #393939); background: transparent; color: inherit; font-size: 14px; margin-bottom: 12px; }
  .card button, .btn { display: inline-block; height: 40px; line-height: 40px; padding: 0 20px; border-radius: 6px; border: none; background: light-dark(#000, #fff); color: light-dark(#fff, #161616); font-size: 14px; font-weight: 500; cursor: pointer; text-decoration: none; }
  .error { color: #dc2626; font-size: 13px; margin-bottom: 12px; }
`;

function chromePage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>${escapeHtml(title)}</title>
<style>${CHROME_CSS}</style>
</head>
<body>${body}</body>
</html>`;
}

export interface WrapperInput {
  title: string;
  brandName: string;
  innerHtml: string;
  slug: string;
  version: number;
  versionCount: number;
  downloadName: string;
}

export function renderWrapper(input: WrapperInput): string {
  const { slug, version, versionCount } = input;
  const versionNav =
    versionCount >= 2
      ? `<nav class="versions" aria-label="Versions">
          ${version > 1 ? `<a href="/a/${escapeHtml(slug)}?v=${version - 1}" aria-label="Older version">‹</a>` : `<span class="dim">‹</span>`}
          <span>v${version} / ${versionCount}</span>
          ${version < versionCount ? `<a href="/a/${escapeHtml(slug)}?v=${version + 1}" aria-label="Newer version">›</a>` : `<span class="dim">›</span>`}
        </nav>`
      : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>${escapeHtml(input.title)}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; margin: 0; }
  html, body { height: 100%; }
  body { display: flex; flex-direction: column; font-family: system-ui, -apple-system, sans-serif; background: light-dark(#fafaf9, #0c0a09); }
  .banner { display: flex; align-items: center; gap: 12px; height: 40px; padding: 0 12px; font-size: 12px; color: light-dark(#57534e, #a8a29e); border-bottom: 1px solid light-dark(#dde1e6, #393939); background: light-dark(#fff, #161616); }
  .banner .title { font-weight: 600; color: light-dark(#121619, #fafaf9); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .banner .spacer { flex: 1; }
  .banner a { color: inherit; text-decoration: none; border: 1px solid light-dark(#dde1e6, #393939); border-radius: 6px; padding: 3px 10px; }
  .banner a:hover { background: light-dark(#f2f4f8, #262626); }
  .versions { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
  .versions a { border: none; padding: 0 4px; font-size: 14px; }
  .versions .dim { opacity: 0.35; padding: 0 4px; }
  iframe { flex: 1; width: 100%; border: 0; background: #fff; }
</style>
</head>
<body>
<div class="banner">
  <span class="title">${escapeHtml(input.title)}</span>
  <span>user-generated content · shared via ${escapeHtml(input.brandName)}</span>
  <span class="spacer"></span>
  ${versionNav}
  <a href="/a/${escapeHtml(slug)}/raw?v=${version}&download=1" download="${escapeHtml(input.downloadName)}">Source</a>
</div>
<iframe sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcdoc="${escapeHtml(input.innerHtml)}" title="${escapeHtml(input.title)}"></iframe>
</body>
</html>`;
}

export function renderHtmlInner(content: string): string {
  if (/<base[\s>]/i.test(content)) return content;
  const headMatch = content.match(/<head[^>]*>/i);
  if (headMatch && headMatch.index !== undefined) {
    const at = headMatch.index + headMatch[0].length;
    return `${content.slice(0, at)}<base target="_blank">${content.slice(at)}`;
  }
  return `<base target="_blank">${content}`;
}

const JSX_IMPORT_MAP = `{
  "imports": {
    "react": "https://esm.sh/react@18.3.1",
    "react-dom": "https://esm.sh/react-dom@18.3.1",
    "react-dom/client": "https://esm.sh/react-dom@18.3.1/client",
    "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime",
    "recharts": "https://esm.sh/recharts@2.12.7?bundle-deps&external=react,react-dom",
    "lucide-react": "https://esm.sh/lucide-react@0.383.0?bundle-deps&external=react,react-dom",
    "d3": "https://esm.sh/d3@7.9.0?bundle-deps",
    "three": "https://esm.sh/three@0.128.0?bundle-deps",
    "lodash": "https://esm.sh/lodash-es@4.17.21",
    "mathjs": "https://esm.sh/mathjs@13.2.3?bundle-deps",
    "papaparse": "https://esm.sh/papaparse@5.4.1?bundle-deps",
    "chart.js": "https://esm.sh/chart.js@4.4.7?bundle-deps",
    "tone": "https://esm.sh/tone@15.0.4?bundle-deps",
    "plotly": "https://esm.sh/plotly.js-dist-min@2.35.2?bundle-deps"
  }
}`;

export function renderJsxInner(source: string, title: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<script type="importmap">${JSX_IMPORT_MAP}</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.26.4/babel.min.js"></script>
<script src="https://cdn.tailwindcss.com/3.4.16"></script>
<style>#error-display { font: 13px/1.5 ui-monospace, monospace; color: #dc2626; white-space: pre-wrap; padding: 16px; }</style>
</head>
<body>
<div id="root"></div>
<div id="error-display"></div>
<script type="module">
const SOURCE = \`${templateLiteralEscape(source)}\`;
const errorBox = document.getElementById("error-display");
try {
  const [React, ReactDOMClient] = await Promise.all([
    import("react"),
    import("react-dom/client"),
  ]);
  window.React = React.default ?? React;

  // Resolve every static import through the import map before executing.
  const specifiers = new Set();
  const importRe = /import\\s+(?:[\\w*{},\\s]+\\s+from\\s+)?["']([^"']+)["']/g;
  for (let m; (m = importRe.exec(SOURCE)); ) specifiers.add(m[1]);
  const moduleCache = {};
  for (const spec of specifiers) {
    moduleCache[spec] = await import(spec);
  }
  moduleCache["react"] = React;
  moduleCache["react-dom/client"] = ReactDOMClient;

  const transformed = Babel.transform(SOURCE, {
    presets: [["react", { runtime: "classic" }]],
    plugins: ["transform-modules-commonjs"],
    filename: "artifact.jsx",
  }).code;

  const module = { exports: {} };
  const require = (spec) => {
    const mod = moduleCache[spec];
    if (!mod) throw new Error("Unresolved import: " + spec);
    return mod;
  };
  new Function("exports", "require", "module", "React", transformed)(
    module.exports, require, module, window.React,
  );
  const Component = module.exports.default ?? module.exports;
  if (typeof Component !== "function") {
    throw new Error("Artifact does not export a React component as its default export.");
  }
  ReactDOMClient.createRoot(document.getElementById("root")).render(
    window.React.createElement(Component),
  );
} catch (err) {
  errorBox.textContent = String(err && err.stack ? err.stack : err);
}
</script>
</body>
</html>`;
}

export function renderMarkdownInner(source: string, title: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.1.6/purify.min.js"></script>
<style>
  :root { color-scheme: light dark; }
  body { max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; font: 15px/1.65 system-ui, -apple-system, sans-serif; background: light-dark(#fff, #161616); color: light-dark(#121619, #fafaf9); }
  h1, h2, h3 { line-height: 1.3; margin: 1.4em 0 0.5em; } h1:first-child { margin-top: 0; }
  p, ul, ol, blockquote, pre, table { margin: 0 0 1em; }
  code { font-family: ui-monospace, monospace; font-size: 0.9em; background: light-dark(#f2f4f8, #262626); border-radius: 4px; padding: 1px 5px; }
  pre { background: light-dark(#f2f4f8, #262626); border-radius: 8px; padding: 14px; overflow-x: auto; } pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid light-dark(#dde1e6, #393939); padding-left: 14px; color: light-dark(#57534e, #a8a29e); }
  a { color: light-dark(#0f62fe, #4589ff); }
  table { border-collapse: collapse; } th, td { border: 1px solid light-dark(#dde1e6, #393939); padding: 6px 10px; text-align: left; }
  img { max-width: 100%; }
</style>
</head>
<body>
<main id="content"></main>
<script>
const SOURCE = ${jsStringLiteral(source)};
const html = DOMPurify.sanitize(marked.parse(SOURCE));
document.getElementById("content").innerHTML = html;
for (const a of document.querySelectorAll("a[href]")) a.target = "_blank";
</script>
</body>
</html>`;
}

const HLJS_LANG_BY_EXT: Record<string, string> = {
  py: "python",
  rs: "rust",
  kt: "kotlin",
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  sh: "bash",
  zsh: "bash",
  yml: "yaml",
  rb: "ruby",
  pl: "perl",
  h: "c",
  hpp: "cpp",
  cs: "csharp",
};

export function renderCodeInner(
  source: string,
  fileName: string,
  title: string,
): string {
  const ext = extensionOf(fileName);
  const lang = HLJS_LANG_BY_EXT[ext] ?? ext;
  const langClass = lang ? ` class="language-${escapeHtml(lang)}"` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css" media="(prefers-color-scheme: light)"/>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css" media="(prefers-color-scheme: dark)"/>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; background: light-dark(#fff, #0d1117); }
  pre { margin: 0; padding: 20px; font: 12.5px/1.65 ui-monospace, monospace; overflow-x: auto; }
</style>
</head>
<body>
<pre><code${langClass}>${escapeHtml(source)}</code></pre>
<script>hljs.highlightAll();</script>
</body>
</html>`;
}

export function renderTextKindInner(
  kind: Exclude<ArtifactKind, "binary">,
  source: string,
  opts: { title: string; fileName: string },
): string {
  if (kind === "html") return renderHtmlInner(source);
  if (kind === "jsx") return renderJsxInner(source, opts.title);
  if (kind === "markdown") return renderMarkdownInner(source, opts.title);
  return renderCodeInner(source, opts.fileName, opts.title);
}

export function renderImageInner(rawUrl: string, title: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${escapeHtml(title)}</title>
<style>:root{color-scheme:light dark;} body { margin: 0; min-height: 100dvh; display: flex; align-items: center; justify-content: center; background: light-dark(#fafaf9, #0c0a09); } img { max-width: 100%; max-height: 100dvh; }</style>
</head>
<body><img src="${escapeHtml(rawUrl)}" alt="${escapeHtml(title)}"/></body>
</html>`;
}

export function renderDownloadInner(input: {
  title: string;
  fileName: string;
  sizeBytes: number;
  rawUrl: string;
}): string {
  const size =
    input.sizeBytes >= 1024 * 1024
      ? `${(input.sizeBytes / (1024 * 1024)).toFixed(1)} MB`
      : `${Math.max(1, Math.round(input.sizeBytes / 1024))} KB`;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${escapeHtml(input.title)}</title>
<style>${CHROME_CSS}</style>
</head>
<body>
<div class="center-card"><div class="card">
  <h1>${escapeHtml(input.title)}</h1>
  <p>${escapeHtml(input.fileName)} · ${size}</p>
  <a class="btn" href="${escapeHtml(input.rawUrl)}" download="${escapeHtml(input.fileName)}">Download</a>
</div></div>
</body>
</html>`;
}

export function renderExpired(input: {
  withinGrace: boolean;
  expiredAt: Date;
}): string {
  const detail = input.withinGrace
    ? "It expired recently — its owner can still renew it from the artifact library."
    : "It has expired and its content is no longer available.";
  return chromePage(
    "410 — expired",
    `<div class="center-card"><div class="card">
      <h1>This link has expired</h1>
      <p>${detail}</p>
    </div></div>`,
  );
}

export function renderNotFound(): string {
  return chromePage(
    "404 — not found",
    `<div class="center-card"><div class="card">
      <h1>Nothing here</h1>
      <p>This link doesn't exist, was made private, or has been deleted.</p>
    </div></div>`,
  );
}

export interface FolderPageArtifact {
  slug: string;
  title: string;
  kind: ArtifactKind;
  version: number;
  viewCount: number;
  createdAt: Date;
  expiresAt: Date | null;
}

export function renderFolderPage(input: {
  name: string;
  brandName: string;
  artifacts: FolderPageArtifact[];
}): string {
  const rows = input.artifacts
    .map((a) => {
      const expired =
        a.expiresAt !== null && a.expiresAt.getTime() < Date.now();
      return `<a class="row${expired ? " expired" : ""}" href="/a/${escapeHtml(a.slug)}">
        <span class="kind">${escapeHtml(a.kind.toUpperCase())}</span>
        <span class="rtitle">${escapeHtml(a.title)}</span>
        <span class="meta">${a.version > 1 ? `v${a.version} · ` : ""}${a.viewCount} views${expired ? " · expired" : ""}</span>
      </a>`;
    })
    .join("\n");
  return chromePage(
    input.name,
    `<style>
      .folder { max-width: 720px; margin: 0 auto; padding: 40px 20px; }
      .folder h1 { font-size: 24px; margin-bottom: 4px; }
      .folder .sub { font-size: 13px; color: light-dark(#57534e, #a8a29e); margin-bottom: 24px; }
      .row { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border: 1px solid light-dark(#dde1e6, #393939); border-radius: 8px; margin-bottom: 8px; text-decoration: none; color: inherit; background: light-dark(#fff, #161616); }
      .row:hover { background: light-dark(#f2f4f8, #262626); }
      .row.expired { opacity: 0.5; }
      .kind { font-size: 10px; font-weight: 700; letter-spacing: 0.5px; border-radius: 999px; padding: 2px 8px; background: light-dark(#edf5ff, #0f1f3a); color: light-dark(#0f62fe, #4589ff); }
      .rtitle { font-size: 14px; font-weight: 500; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .meta { font-size: 12px; color: light-dark(#57534e, #a8a29e); white-space: nowrap; }
    </style>
    <div class="folder">
      <h1>${escapeHtml(input.name)}</h1>
      <p class="sub">${input.artifacts.length} shared artifact${input.artifacts.length === 1 ? "" : "s"} · via ${escapeHtml(input.brandName)}</p>
      ${rows}
    </div>`,
  );
}
