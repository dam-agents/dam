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
  form { margin-top: 16px; }
  button { font: inherit; font-size: 14px; padding: 6px 14px; border-radius: 6px; border: 1px solid light-dark(#dde1e6, #393939); background: light-dark(#fff, #262626); color: inherit; cursor: pointer; }
`;

/**
 * UNIT_BOUNDARY_DESCRIPTION: The page an Environment address, or the share
 * host's front door for one, answers with when it does not let the visitor
 * through: a missing Environment, a visitor who may not open it, or one that
 * is not answering. It never names the Environment's owner or anything the
 * visitor could not already see in the address. A refusal on the share host
 * offers to switch account, by the share host's own sign-out. A step of a
 * sign-in moves the browser on by itself, with a link for one that does not;
 * it is a page, not a redirect, so a sign-in through many endpoints never
 * reaches the browser's limit on redirects in a row.
 */
export function renderGatePage(input: {
  brandName: string;
  title: string;
  body: string;
  switchAccount?: { action: string; next: string };
  continueTo?: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex"/>
${input.continueTo ? `<meta http-equiv="refresh" content="0;url=${escapeHtml(input.continueTo)}"/>` : ""}
<title>${escapeHtml(input.title)}</title>
<style>${CSS}</style>
</head>
<body><div class="center"><div class="card">
<h1>${escapeHtml(input.title)}</h1>
<p>${escapeHtml(input.body)}</p>
${input.continueTo ? `<p><a href="${escapeHtml(input.continueTo)}">Continue</a></p>` : ""}
${
  input.switchAccount
    ? `<form method="post" action="${escapeHtml(input.switchAccount.action)}"><input type="hidden" name="next" value="${escapeHtml(input.switchAccount.next)}"><button type="submit">Switch account</button></form>`
    : ""
}
<p class="brand">An Environment on ${escapeHtml(input.brandName)}</p>
</div></div></body>
</html>`;
}
