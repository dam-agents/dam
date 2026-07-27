import { EXPERIMENT_FEED_MESSAGE_TYPE, type TraceFeed } from "api-server-api";

// Baking final results into a dashboard (#2942): a dashboard artifact is a
// renderer with no data — live, the host page pushes Trace Feed frames over
// postMessage. On a terminal transition the platform publishes a snapshot
// version: the same HTML plus one appended script that replays the final feed
// through the SAME message contract (window.postMessage to itself), so any
// dashboard — stock or agent-generated — becomes self-contained without
// knowing its internals. A live host pushing fresher frames still wins: its
// messages arrive after the baked replay.

const SNAPSHOT_OPEN = "<!--experiment-feed-snapshot-->";
const SNAPSHOT_CLOSE = "<!--/experiment-feed-snapshot-->";

/** True when the HTML already carries a baked feed (a snapshot version). */
export function hasFeedSnapshot(html: string): boolean {
  return html.includes(SNAPSHOT_OPEN);
}

/** Return the HTML with the final feed baked in. Replaces any previous
 *  snapshot block (a bespoke dashboard reused across experiments would
 *  otherwise accumulate replays), and injects before `</body>` when present
 *  so the dashboard's own scripts — and their message listeners — are
 *  registered first. */
export function injectFeedSnapshot(html: string, feed: TraceFeed): string {
  const base = stripFeedSnapshot(html);
  // <-escape so no `</script>` (or any tag) inside the JSON can
  // terminate the injected script element.
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
