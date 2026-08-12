/** Where a harness publishes what changed between image versions.
 *
 *  Keyed on a fragment of the image's *name*, because that is the only harness
 *  identity a sandbox carries — a template's name is admin-editable and its
 *  `docsUrl` points at the harness's docs, not its release history. A fragment
 *  rather than the whole name, so the variants of one harness all resolve:
 *  `claude-code`, `claude-code-vm`, and a locally built `platform-claude-code`
 *  are the same product. Each points at a release *list*: one update can span
 *  several versions. */
const WHATS_NEW_BY_HARNESS: ReadonlyArray<readonly [string, string]> = [
  ["claude-code", "https://code.claude.com/docs/en/whats-new"],
  ["codex", "https://github.com/openai/codex/releases"],
  ["bob", "https://bob.ibm.com/docs/shell/changelog"],
];

/** The image's name alone: no registry, no port, no tag, no digest. Matching is
 *  confined to it so a registry host can never decide the harness. */
function imageName(image: string): string {
  const segment = image.slice(image.lastIndexOf("/") + 1);
  return segment.split("@")[0]!.split(":")[0]!;
}

/** Null for a harness that publishes nothing we know of, which hides the link
 *  rather than pointing it somewhere that can't answer the question. */
export function whatsNewUrl(image: string): string | null {
  const name = imageName(image);
  return (
    WHATS_NEW_BY_HARNESS.find(([fragment]) => name.includes(fragment))?.[1] ??
    null
  );
}
