export function buildAppendAgentsMdCommand(section: string): string {
  const lines = [...section.split("\n"), ""].map(
    (line) => `'${line.replaceAll("'", "'\\''")}'`,
  );
  return [
    'mkdir -p "$HOME/.agents" "$HOME/.claude"',
    `printf '%s\\n' ${lines.join(" ")} >> "$HOME/.agents/AGENTS.md"`,
    '[ -e "$HOME/.claude/CLAUDE.md" ] || ln -s "$HOME/.agents/AGENTS.md" "$HOME/.claude/CLAUDE.md"',
  ].join("; ");
}
