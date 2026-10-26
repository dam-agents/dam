export const AGENT_NAME_PREFIX = "agent";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function nextSandboxName(
  prefix: string,
  takenNames: Iterable<string>,
): string {
  const pattern = new RegExp(
    `^${escapeRegExp(prefix.toLowerCase())}(?:-(\\d+))?$`,
  );
  let highest = 0;
  for (const taken of takenNames) {
    const match = pattern.exec(taken.trim().toLowerCase());
    if (!match) continue;
    const ordinal = match[1] === undefined ? 1 : Number(match[1]);
    if (Number.isSafeInteger(ordinal) && ordinal > highest) highest = ordinal;
  }
  return highest === 0 ? prefix : `${prefix}-${highest + 1}`;
}
