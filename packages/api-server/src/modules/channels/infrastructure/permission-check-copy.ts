export const channelPermissionCheckGuidance = [
  "<permission-check>",
  "A tool call can be refused by your harness's permission mode before it " +
    "runs: a mode that asks is refused every time on a channel turn, because " +
    "nobody is there to answer, and Claude Code's auto mode adds a classifier " +
    "verdict of its own. Nothing in this conversation can approve it, and no " +
    "platform setting grants it — not a Connection's scope, not a repository's " +
    "permissions — so never name a setting that does not exist. Don't retry " +
    "the same call: say plainly what was blocked and that your owner can change " +
    "the agent's mode (Mode on Claude Code, Approvals on Bob), and offer what " +
    "you can still do without it.",
  "</permission-check>",
].join("\n");
