export function buildAppendAgentsMdCommand(section: string): string {
  const quote = (line: string) => `'${line.replaceAll("'", "'\\''")}'`;
  const rawLines = section.split("\n");
  const lines = [...rawLines, ""].map(quote);
  const marker = rawLines.find((line) => line.trim() !== "");
  const append = `printf '%s\\n' ${lines.join(" ")} >> "$HOME/.agents/AGENTS.md"`;
  return [
    'mkdir -p "$HOME/.agents" "$HOME/.claude"',
    marker === undefined
      ? append
      : `grep -qsxF ${quote(marker)} "$HOME/.agents/AGENTS.md" || ${append}`,
    '[ -e "$HOME/.claude/CLAUDE.md" ] || [ -L "$HOME/.claude/CLAUDE.md" ] || ln -s "$HOME/.agents/AGENTS.md" "$HOME/.claude/CLAUDE.md"',
  ].join("; ");
}
