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

export const MEANING_PICKS = 3;

export function planMeaningSequence(
  meanings: readonly string[],
  random: () => number = Math.random,
): string[] {
  const [anchor, ...rest] = meanings;
  if (anchor === undefined) return [];
  const pool = [...rest];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const picks = pool.slice(0, MEANING_PICKS);
  return picks.length === 0 ? [anchor] : [anchor, ...picks, anchor];
}

export const MEANING_LINES = 3;

export function splitMeaningLines(meaning: string): string[] {
  const lines: string[] = [];
  for (const word of meaning.split(/\s+/).filter(Boolean)) {
    const startsLine = /^\p{Lu}/u.test(word) && lines.length < MEANING_LINES;
    if (startsLine || lines.length === 0) lines.push(word);
    else lines[lines.length - 1] += ` ${word}`;
  }
  return lines;
}
