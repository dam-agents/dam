import { getBrand } from "../../brand.js";

export function startupTips(sandbox: string): readonly string[] {
  const { name, short } = getBrand();
  return [
    "Idle sandboxes hibernate to save resources, then wake the instant you or a schedule ping them.",
    "Your workspace survives between runs. Pick up exactly where the sandbox left off.",
    `Open a local terminal with the ${name} CLI: \`${short} chat ${sandbox}\``,
    "Approvals are enforced outside the sandbox, so a compromised agent cannot approve itself.",
    "Connect a sandbox to Slack or Telegram, then talk to it there. Config › Channels.",
    `Open this sandbox in VS Code: \`${short} ssh connect -x code ${sandbox}\``,
    "Run a sandbox on a schedule to handle routine tasks. Config › Schedules.",
    "Choose the trusted defaults network preset to stop a sandbox reaching untrusted domains.",
    "Bring your local CLAUDE.md, .claude/, and skills straight into a cloud sandbox.",
    "You do not have to wait your turn. Type while the sandbox works and your message queues.",
    "File paths the sandbox writes in chat are clickable. They open the file beside the conversation.",
    "Set the hibernation timeout to 0 to stop a sandbox sleeping, for background work with no open session.",
    "Drop a .md file on the Skills page to turn it into a skill.",
    "Drop a whole folder into Files to upload it. node_modules and .venv are skipped for you.",
    "Publish a skill you wrote here as a pull request, then track it to get later updates back.",
    "Artifacts outlive the sandbox. Share a public link or browse past versions.",
    "Allow a blocked request once, always, or for the whole host. Each choice writes a real rule.",
    `Add an MCP server by URL and ${name} works out its authorization for you. Config › Connections.`,
    "Schedules take quiet hours and a timezone, so a nightly run stays quiet overnight.",
    "Turn on ambient mode and a sandbox reads along in a Slack channel without an @-mention.",
    "You can attach connections to inject API keys without baking secrets into the image.",
    "Scheduled runs wake the sandbox automatically — no need to keep it running between jobs.",
    "Template updates roll out new images without losing your sandbox's persistent state.",
    "Network egress is deny-by-default. Connections allowlist only the hosts your agent needs.",
    "Run one goal across several variants at once and watch them chart live with Experiments.",
    "Point a knowledge base at your docs and ask it questions in chat.",
    "Artifact previews open beside the chat, so you can read the result and keep talking.",
    "Set “Delete after…” on an artifact and it is deleted permanently on that date, public or private.",
    "Ask a sandbox to publish its work as an artifact, then share the link with colleagues.",
    "An artifact keeps every version. Step back through its history in the preview.",
    "See what a sandbox costs. Settings › Usage breaks spend down by model and by day.",
    `Create an API key in Settings › API keys to use the ${name} CLI without a browser.`,
  ];
}
