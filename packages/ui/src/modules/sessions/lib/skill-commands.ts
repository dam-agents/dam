import type { AcpUpdate } from "../../acp/types.js";

export interface SkillCommand {
  name: string;
  description: string;
}

export interface CommandTrigger {
  start: number;
  end: number;
  query: string;
}

const TOKEN_END = /\s/;
const MENTION = "$";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the `/<name>` commands the chat input offers,
 * and where one is typed. A harness runs a command only when the prompt
 * starts with `/<name>`, so the list opens only for a `/` at the start of the
 * input or of a line, never for one inside a word or a path (`src/foo`). The
 * token runs from the `/` to the first white space, and a white space between
 * the `/` and the caret closes the list.
 */
export function commandTrigger(
  text: string,
  caret: number,
): CommandTrigger | null {
  const lineStart = text.lastIndexOf("\n", caret - 1) + 1;
  if (text[lineStart] !== "/" || caret <= lineStart) return null;
  const typed = text.slice(lineStart + 1, caret);
  if (TOKEN_END.test(typed)) return null;
  let end = caret;
  while (end < text.length && !TOKEN_END.test(text[end]!)) end += 1;
  return { start: lineStart, end, query: typed };
}

export function filterCommands(
  commands: readonly SkillCommand[],
  query: string,
): SkillCommand[] {
  const q = query.toLowerCase().replace(/^\$/, "");
  const rank = (c: SkillCommand): number => {
    const name = c.name.toLowerCase().replace(/^\$/, "");
    if (name.startsWith(q)) return 0;
    if (name.includes(q)) return 1;
    if (c.description.toLowerCase().includes(q)) return 2;
    return -1;
  };
  return commands
    .map((command) => ({ command, rank: rank(command) }))
    .filter((c) => c.rank >= 0)
    .sort((a, b) => a.rank - b.rank)
    .map((c) => c.command);
}

export function mergeCommands(
  reported: readonly SkillCommand[],
  skills: readonly SkillCommand[],
): SkillCommand[] {
  const byName = new Map<string, SkillCommand>();
  for (const c of reported) byName.set(c.name, c);
  for (const s of skills) {
    const known = byName.get(s.name);
    if (!known) byName.set(s.name, s);
    else if (!known.description && s.description)
      byName.set(s.name, { ...known, description: s.description });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function commandText(name: string): string {
  return name.startsWith(MENTION) ? name : `/${name}`;
}

export function insertCommand(
  text: string,
  trigger: CommandTrigger,
  name: string,
): { text: string; caret: number } {
  const rest = text.slice(trigger.end).replace(/^[ \t]+/, "");
  const inserted = `${commandText(name)} `;
  return {
    text: text.slice(0, trigger.start) + inserted + rest,
    caret: trigger.start + inserted.length,
  };
}

export function reportedCommandsOf(update: {
  availableCommands: readonly { name: string; description?: string | null }[];
}): SkillCommand[] {
  return update.availableCommands
    .filter((c) => c.name.trim().length > 0)
    .map((c) => ({ name: c.name, description: c.description ?? "" }));
}

export function lastReportedCommands(
  updates: readonly { update: AcpUpdate }[],
): SkillCommand[] | null {
  for (let i = updates.length - 1; i >= 0; i--) {
    const { update } = updates[i]!;
    if (update.sessionUpdate === "available_commands_update")
      return reportedCommandsOf(update);
  }
  return null;
}
