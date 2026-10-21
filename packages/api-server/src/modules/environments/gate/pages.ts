import { escapeHtml } from "../../../core/escape-html.js";

const CSS = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; margin: 0; }
  body { font-family: system-ui, -apple-system, sans-serif; background: #fafaf9; color: #121619; }
  @media (prefers-color-scheme: dark) { body { background: #0c0a09; color: #fafaf9; } }
  .center { min-height: 100dvh; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .card { max-width: 420px; width: 100%; background: light-dark(#fff, #161616); border: 1px solid light-dark(#dde1e6, #393939); border-radius: 12px; padding: 32px; text-align: center; }
  h1 { font-size: 20px; margin-bottom: 8px; }
  p { font-size: 14px; color: light-dark(#57534e, #a8a29e); }
  .brand { font-size: 12px; margin-top: 16px; color: light-dark(#78716c, #78716c); }
`;

/**
 * UNIT_BOUNDARY_DESCRIPTION: The page an Environment address answers with
 * when it does not relay: a missing Environment, a visitor who may not open
 * it, or one that is not answering. It never names the Environment's owner or
 * anything the visitor could not already see in the address.
 */
export function renderGatePage(input: {
  brandName: string;
  title: string;
  body: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>${escapeHtml(input.title)}</title>
<style>${CSS}</style>
</head>
<body><div class="center"><div class="card">
<h1>${escapeHtml(input.title)}</h1>
<p>${escapeHtml(input.body)}</p>
<p class="brand">An Environment on ${escapeHtml(input.brandName)}</p>
</div></div></body>
</html>`;
}
