import { getBrand } from "../../brand.js";

/**
 * One-liners shown while a sandbox starts. Read at render, not at import: the
 * brand arrives from `/api/brand` after this module is first evaluated, so a
 * module-level array would freeze the bundled fallback name.
 *
 * Two rules for adding one:
 *
 * - **Keep it under ~100 characters.** That is what fits the tip card in two
 *   lines; a longer one wraps to three and shifts the centered column while
 *   the user is watching it.
 * - **Describe something the product does today.** A tip is read at the moment
 *   someone is deciding what this thing is for, so a stale one costs more than
 *   no tip at all.
 */
export function startupTips(): readonly string[] {
  const { name, short } = getBrand();
  return [
    "Sandboxes sleep when idle and wake when you open a chat. Files, sessions, and skills survive the nap.",
    "Add a GitHub repo as a skill source, or drop a .md file on the Skills page to write one in place.",
    `Publish a skill you wrote back to its source repo as a pull request, without leaving ${name}.`,
    "Model, mode, and effort live on the sandbox's configuration page. Changes apply to your next session.",
    "Link a Slack or Telegram channel to a sandbox and you can talk to the same agent from there.",
    `There's a command line too — \`${short} chat\` opens a session straight from your terminal.`,
    "Agents publish artifacts — pages, markdown, code, files — to your library, shareable by link.",
    "A running sandbox holds compute against your budget. Stop an idle one to free room for another.",
    "Approvals are enforced outside the sandbox, so a compromised agent cannot approve itself.",
    "Credentials are injected on the wire by the gateway. The agent never holds your tokens.",
  ];
}
