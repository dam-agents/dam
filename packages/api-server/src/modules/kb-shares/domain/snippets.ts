export function extractSnippets(
  text: string,
  needles: readonly string[],
  contextLines: number,
  maxSnippets: number,
): string[] {
  const lines = text.split("\n");
  const lowered = lines.map((line) => line.toLowerCase());
  const snippets: string[] = [];
  const used = new Set<number>();
  for (const [lineIndex, line] of lowered.entries()) {
    if (snippets.length >= maxSnippets) break;
    if (used.has(lineIndex)) continue;
    if (!needles.some((needle) => line.includes(needle))) continue;
    const from = Math.max(0, lineIndex - contextLines);
    const to = Math.min(lines.length - 1, lineIndex + contextLines);
    for (let i = from; i <= to; i += 1) used.add(i);
    snippets.push(lines.slice(from, to + 1).join("\n"));
  }
  return snippets;
}
