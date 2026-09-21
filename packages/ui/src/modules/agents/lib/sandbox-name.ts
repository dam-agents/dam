export type SandboxNameKind = "coding-agent" | "experiment" | "starter-kit";

const BASE_BY_KIND: Record<SandboxNameKind, string> = {
  "coding-agent": "agent",
  experiment: "experiment",
  "starter-kit": "agent",
};

export function sandboxNameBase(
  kind: SandboxNameKind,
  kitName?: string | null,
): string {
  const kit = kitName?.trim();
  return kit ? kit : BASE_BY_KIND[kind];
}

export function nextSandboxName(
  base: string,
  takenNames: Iterable<string>,
): string {
  const taken = new Set<string>();
  for (const name of takenNames) taken.add(name.trim().toLowerCase());
  const root = base.toLowerCase();
  if (!taken.has(root)) return base;
  let ordinal = 2;
  while (taken.has(`${root}-${ordinal}`)) ordinal += 1;
  return `${base}-${ordinal}`;
}
