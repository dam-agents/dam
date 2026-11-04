import { printable } from "../../shared/printable.js";
import type { KitUpdateChanges, KitUpdateStatus } from "api-server-api";
import { shortKitVersion } from "./kit-ref.js";

export function describeKitUpdate(
  status: KitUpdateStatus | null,
  agentRef: string,
): string {
  if (status === null) return "unknown";
  const latest = status.latest ? shortKitVersion(status.latest) : null;
  switch (status.state) {
    case "available":
      return `update available (${latest}): \`dam kit update ${agentRef}\``;
    case "pending":
      return `update to ${shortKitVersion(status.pending?.targetCommit ?? status.latest ?? "")} in progress in the agent's session`;
    case "skipped":
      return `up to date with the version you kept; ${latest} skipped`;
    case "onboarding":
      return "updates wait until onboarding finishes";
    case "unreachable":
      return "cannot check for updates: the kit's repository did not answer";
    case "up-to-date":
      return "up to date";
  }
}

export function renderChanges(changes: KitUpdateChanges | null): string {
  if (changes === null) return "No changes to show.\n";
  const range =
    changes.versionFrom && changes.versionTo
      ? `${printable(changes.versionFrom)} → ${printable(changes.versionTo)}`
      : `${shortKitVersion(changes.from)} → ${shortKitVersion(changes.to)}`;
  const lines = [`Kit update · ${range}`];
  if (changes.changelog)
    lines.push("", printable(changes.changelog, { lines: true }).trimEnd());
  if (changes.commits) {
    lines.push("");
    for (const c of changes.commits)
      lines.push(`${shortKitVersion(c.sha)} ${printable(c.subject)}`);
    const hidden = (changes.totalCommits ?? 0) - changes.commits.length;
    if (hidden > 0) lines.push(`and ${hidden} more`);
  }
  if (!changes.changelog && !changes.commits)
    lines.push(
      "",
      changes.totalCommits
        ? `${changes.totalCommits} new commits.`
        : "The summary is not available right now.",
    );
  lines.push("", `Compare: ${printable(changes.compareUrl)}`);
  return `${lines.join("\n")}\n`;
}
