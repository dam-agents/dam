export type SandboxNameKind = "coding-agent" | "experiment" | "knowledge-base";

const PREFIX: Record<SandboxNameKind, string> = {
  "coding-agent": "codingagent",
  experiment: "experiment",
  "knowledge-base": "knowledgebase",
};

export function nextSandboxName(
  kind: SandboxNameKind,
  takenNames: Iterable<string>,
): string {
  const prefix = PREFIX[kind];
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  let highest = 0;
  for (const taken of takenNames) {
    const match = pattern.exec(taken.trim().toLowerCase());
    if (!match) continue;
    const ordinal = Number(match[1]);
    if (Number.isSafeInteger(ordinal) && ordinal > highest) highest = ordinal;
  }
  return `${prefix}-${highest + 1}`;
}
