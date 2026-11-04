import { escapeHtml } from "../../../core/escape-html.js";

const CSS = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; margin: 0; }
  body { font-family: system-ui, -apple-system, sans-serif; background: #ffffff; color: #121619; }
  @media (prefers-color-scheme: dark) { body { background: #161616; color: #fafaf9; } }
  .center { min-height: 100dvh; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .card { max-width: 420px; width: 100%; background: light-dark(#fff, #161616); border: 1px solid light-dark(#dde1e6, #393939); border-radius: 12px; padding: 32px; text-align: center; }
  h1 { font-size: 20px; margin-bottom: 8px; }
  p { font-size: 14px; color: light-dark(#4d5358, #a8a29e); }
  .brand { font-size: 12px; margin-top: 16px; color: light-dark(#78716c, #78716c); }
  form { margin-top: 16px; }
  button, .button { font: inherit; font-size: 14px; padding: 6px 14px; border-radius: 6px; border: 1px solid light-dark(#dde1e6, #393939); background: light-dark(#fff, #262626); color: inherit; cursor: pointer; }
  .button { display: inline-block; margin-top: 16px; text-decoration: none; }
  .primary { background: light-dark(#000000, #ffffff); color: light-dark(#ffffff, #161616); border-color: transparent; }
  .spinner { width: 24px; height: 24px; margin: 0 auto 16px; border: 2px solid light-dark(#dde1e6, #393939); border-top-color: light-dark(#000000, #ffffff); border-radius: 50%; animation: spin 0.9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pulse { 50% { opacity: 0.3; } }
  @media (prefers-reduced-motion: reduce) { .spinner { animation: pulse 2s ease-in-out infinite; } }
`;

/**
 * UNIT_BOUNDARY_DESCRIPTION: The page an Environment address, or the share
 * host's front door for one, answers with when it does not let the visitor
 * through: a missing Environment, a visitor who may not open it, or one that
 * is not ready yet. It never names the Environment's owner or anything the
 * visitor could not already see in the address. A refusal on the share host
 * offers to switch account, by the share host's own sign-out. A step of a
 * sign-in moves the browser on by itself, with a link for one that does not;
 * it is a page, not a redirect, so a sign-in through many endpoints never
 * reaches the browser's limit on redirects in a row. A page that waits for an
 * Environment to start shows that it is working, asks the gate's status every
 * few seconds, and reloads itself once the gate says the
 * app is ready or did not start, so the gate's own page says which. A start
 * that takes long is still waited for: the page says it is still starting and
 * asks less often, so a long install opens without a reload by hand. A page
 * that offers to try again links to where the gate starts afresh.
 */
export function renderGatePage(input: {
  brandName: string;
  title: string;
  body: string;
  switchAccount?: { action: string; next: string };
  continueTo?: string;
  waitFor?: { statusPath: string; slowAfterMs: number };
  retry?: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex, nofollow"/>
${input.continueTo ? `<meta http-equiv="refresh" content="0;url=${escapeHtml(input.continueTo)}"/>` : ""}
<title>${escapeHtml(input.title)}</title>
<style>${CSS}</style>
</head>
<body><div class="center"><div class="card">
${input.waitFor ? `<div class="spinner" aria-hidden="true"></div>` : ""}
<h1 id="title">${escapeHtml(input.title)}</h1>
<p id="message" aria-live="polite">${escapeHtml(input.body)}</p>
${input.retry ? `<a class="button primary" href="${escapeHtml(input.retry)}">Try again</a>` : ""}
${input.continueTo ? `<p><a href="${escapeHtml(input.continueTo)}">Continue</a></p>` : ""}
${
  input.switchAccount
    ? `<form method="post" action="${escapeHtml(input.switchAccount.action)}"><input type="hidden" name="next" value="${escapeHtml(input.switchAccount.next)}"><button type="submit">Switch account</button></form>`
    : ""
}
<p class="brand">An Environment on ${escapeHtml(input.brandName)}</p>
</div></div>
${input.waitFor ? waitScript(input.waitFor) : ""}</body>
</html>`;
}

const POLL_MS = 2_000;
const SLOW_POLL_MS = 15_000;

function waitScript(wait: { statusPath: string; slowAfterMs: number }) {
  const config = JSON.stringify({
    status: wait.statusPath,
    slowAfterMs: wait.slowAfterMs,
    pollMs: POLL_MS,
    slowPollMs: SLOW_POLL_MS,
  }).replaceAll("<", "\\u003c");
  return `<script>
(function () {
  var c = ${config};
  var started = Date.now();
  var slow = false;
  var timer = null;
  function later() {
    clearTimeout(timer);
    timer = setTimeout(check, slow ? c.slowPollMs : c.pollMs);
  }
  function stillStarting() {
    slow = true;
    document.title = "Still starting";
    document.getElementById("title").textContent = "Still starting";
    document.getElementById("message").textContent = "The Environment is taking longer than usual. This page keeps checking and opens it as soon as it is ready.";
  }
  function check() {
    if (!slow && Date.now() - started > c.slowAfterMs) stillStarting();
    fetch(c.status, { cache: "no-store", credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) {
        if (s && (s.state === "ready" || s.state === "failed")) return location.reload();
        later();
      }, later);
  }
  later();
})();
</script>`;
}
