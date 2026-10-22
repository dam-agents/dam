import { BUTLER_NAMES } from "./butler-names.js";

const AGENT_NAME_PREFIX = "agent";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizedName(name: string): string {
  return name.trim().toLowerCase();
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
    const match = pattern.exec(normalizedName(taken));
    if (!match) continue;
    const ordinal = match[1] === undefined ? 1 : Number(match[1]);
    if (Number.isSafeInteger(ordinal) && ordinal > highest) highest = ordinal;
  }
  return highest === 0 ? prefix : `${prefix}-${highest + 1}`;
}

export function nextAgentName(
  takenNames: Iterable<string>,
  options: { random?: () => number } = {},
): string {
  const taken = new Set(Array.from(takenNames, normalizedName));
  const { random = Math.random } = options;
  const free = BUTLER_NAMES.filter((name) => !taken.has(normalizedName(name)));
  if (free.length === 0) return nextSandboxName(AGENT_NAME_PREFIX, taken);
  return free[Math.floor(random() * free.length)];
}
