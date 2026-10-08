export type SandboxNameKind =
  | "coding-agent"
  | "experiment"
  | "knowledge-base"
  | "research"
  | "assistant";

const PREFIX: Record<SandboxNameKind, string> = {
  "coding-agent": "codingagent",
  experiment: "experiment",
  "knowledge-base": "knowledgebase",
  research: "research",
  assistant: "assistant",
};

export function nextSandboxName(
  kind: SandboxNameKind,
  takenNames: Iterable<string>,
): string {
  return nextNameWithPrefix(PREFIX[kind], takenNames);
}

export function nextNameWithPrefix(
  prefix: string,
  takenNames: Iterable<string>,
): string {
  const normalized = prefix.toLowerCase();
  const pattern = new RegExp(`^${normalized}-(\\d+)$`);
  let highest = 0;
  for (const taken of takenNames) {
    const match = pattern.exec(taken.trim().toLowerCase());
    if (!match) continue;
    const ordinal = Number(match[1]);
    if (Number.isSafeInteger(ordinal) && ordinal > highest) highest = ordinal;
  }
  return `${normalized}-${highest + 1}`;
}
