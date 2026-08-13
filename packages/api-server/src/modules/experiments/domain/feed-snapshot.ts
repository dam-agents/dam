import { EXPERIMENT_FEED_MESSAGE_TYPE, type TraceFeed } from "api-server-api";

const SNAPSHOT_OPEN = "<!--experiment-feed-snapshot-->";
const SNAPSHOT_CLOSE = "<!--/experiment-feed-snapshot-->";

export function hasFeedSnapshot(html: string): boolean {
  return html.includes(SNAPSHOT_OPEN);
}

export function injectFeedSnapshot(html: string, feed: TraceFeed): string {
  const base = stripFeedSnapshot(html);
  const payload = JSON.stringify({
    type: EXPERIMENT_FEED_MESSAGE_TYPE,
    feed,
  }).replace(/</g, "\\u003c");
  const block = [
    SNAPSHOT_OPEN,
    "<script>",
    "(function () {",
    `  var payload = ${payload};`,
    '  var replay = function () { window.postMessage(payload, "*"); };',
    '  if (document.readyState === "complete") setTimeout(replay, 0);',
    '  else window.addEventListener("load", function () { setTimeout(replay, 0); });',
    "})();",
    "</script>",
    SNAPSHOT_CLOSE,
  ].join("\n");

  const bodyClose = base.toLowerCase().lastIndexOf("</body>");
  if (bodyClose === -1) return `${base}\n${block}\n`;
  return `${base.slice(0, bodyClose)}${block}\n${base.slice(bodyClose)}`;
}

function stripFeedSnapshot(html: string): string {
  const open = html.indexOf(SNAPSHOT_OPEN);
  if (open === -1) return html;
  const close = html.indexOf(SNAPSHOT_CLOSE, open);
  if (close === -1) return html;
  return html.slice(0, open) + html.slice(close + SNAPSHOT_CLOSE.length);
}
