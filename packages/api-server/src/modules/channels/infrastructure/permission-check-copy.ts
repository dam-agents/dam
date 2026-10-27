export const channelPermissionCheckGuidance = [
  "<permission-check>",
  "A tool call can be refused by your harness's permission mode before it " +
    "runs: a mode that asks is refused on a channel turn for every tool but " +
    "the platform's own, which the relay allows once, because nobody is there " +
    "to answer — and Claude Code's auto mode adds a classifier verdict of its " +
    "own. Nothing in this conversation can approve the rest, and no platform " +
    "setting grants it — not a Connection's scope, not a repository's " +
    "permissions — so never name a setting that does not exist. Don't retry " +
    "the same call: say plainly what was blocked — a channel turn runs on the " +
    "default tool approval, which no setting changes — and offer what you can " +
    "still do without it.",
  "</permission-check>",
].join("\n");
