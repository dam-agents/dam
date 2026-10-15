export function fencedCode(code: string, language: string): string {
  const longestRun = Math.max(
    2,
    ...[...code.matchAll(/`+/g)].map((match) => match[0].length),
  );
  const fence = "`".repeat(longestRun + 1);
  return `${fence}${language}\n${code}\n${fence}`;
}
