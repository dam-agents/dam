export function parseNameMeanings(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const meanings = parsed
    .filter((m): m is string => typeof m === "string")
    .map((m) => m.trim())
    .filter((m) => m !== "");
  return [...new Set(meanings)];
}

export function pickNextMeaning(
  meanings: readonly string[],
  current: string | undefined,
  random: () => number = Math.random,
): string | undefined {
  const candidates = meanings.filter((m) => m !== current);
  if (candidates.length === 0) return meanings[0];
  return candidates[Math.floor(random() * candidates.length)];
}
