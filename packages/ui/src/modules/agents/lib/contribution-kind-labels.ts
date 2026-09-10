const CONTRIBUTION_KIND_LABELS: Record<string, string> = {
  env: "environment variables",
  "egress-allow": "network access",
  "egress-inject": "network credentials",
  file: "files",
  "mcp-entry": "MCP servers",
  "skill-ref": "skills",
};

export function contributionKindLabel(kind: string): string {
  return CONTRIBUTION_KIND_LABELS[kind] ?? kind;
}

export function contributionKindList(kinds: string[]): string {
  const labels = [...new Set(kinds.map(contributionKindLabel))];
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]!}`;
}
