// Pilot choice: server emits a standalone HTML page that the UI opens in a new
// tab (via fetch + blob URL — see sidebar.tsx). Trade-off: no UI shell, no
// shareable URL, no back-button. Upgrade path is a React route at /usage that
// reads the existing JSON endpoint; this file + the blob trick go away.
import type { ViewName } from "./services/report-service.js";

export type ViewResult =
  | { kind: "ok"; rows: ReadonlyArray<Record<string, unknown>> }
  | { kind: "error"; reason: string };

/** Render a full HTML page with one table per view. Plain, no JS, no external CSS. */
export function renderHtmlReport(
  generatedAt: Date,
  views: ReadonlyArray<readonly [ViewName, ViewResult]>,
): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    "<title>Platform usage report</title>",
    `<style>${CSS}</style>`,
    "</head>",
    "<body>",
    "<h1>Platform usage report</h1>",
    `<p class="meta">Static - Generated ${escapeHtml(generatedAt.toISOString())}</p>`,
    views.map(([name, result]) => renderSection(name, result)).join("\n"),
    "</body>",
    "</html>",
  ].join("\n");
}

function renderSection(name: ViewName, result: ViewResult): string {
  const heading = `<h2 id="${escapeHtml(name)}">${escapeHtml(name)}</h2>`;
  if (result.kind === "error") {
    return `${heading}<p class="error">failed to load: ${escapeHtml(result.reason)}</p>`;
  }
  if (result.rows.length === 0)
    return `${heading}<p class="empty">(no rows)</p>`;
  const cols = Object.keys(result.rows[0]!);
  const header = `<tr>${cols.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr>`;
  const body = result.rows
    .map(
      (r) =>
        `<tr>${cols.map((c) => `<td>${escapeHtml(formatCell(r[c]))}</td>`).join("")}</tr>`,
    )
    .join("");
  return `${heading}<table><thead>${header}</thead><tbody>${body}</tbody></table>`;
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.join(",");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CSS = `
  body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin: 2rem; max-width: 120ch; color: #1a1a1a; }
  h1 { margin: 0 0 .25rem 0; font-size: 1.25rem; }
  h2 { margin: 2rem 0 .25rem 0; font-size: 0.95rem; color: #666; font-weight: 600; }
  .meta { color: #888; font-size: 0.85rem; margin: 0 0 1.5rem 0; }
  table { border-collapse: collapse; margin-bottom: 0.5rem; font-size: 0.85rem; }
  th, td { text-align: left; padding: 0.2rem 1rem 0.2rem 0; vertical-align: top; }
  th { font-weight: 600; border-bottom: 1px solid #ccc; }
  .empty { color: #aaa; font-style: italic; font-size: 0.85rem; }
  .error { color: #b00; font-size: 0.85rem; }
  @media (prefers-color-scheme: dark) {
    body { background: #1a1a1a; color: #e0e0e0; }
    h2 { color: #aaa; }
    .meta, .empty { color: #888; }
    .error { color: #f66; }
    th { border-color: #444; }
  }
`;
