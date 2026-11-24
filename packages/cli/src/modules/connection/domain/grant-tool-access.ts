import {
  toolRuleSchema,
  type ConnectionTool,
  type GrantToolAccess,
  type ToolRule,
} from "api-server-api";
import { err, ok, type Result } from "../../../result.js";

const RULES_HINT = toolRuleSchema.options.join("|");

export interface ToolAccessFlags {
  read?: string;
  write?: string;
  tool: readonly string[];
  resetTool: readonly string[];
}

export interface ToolAccessChange {
  read?: ToolRule;
  write?: ToolRule;
  tools: ReadonlyMap<string, ToolRule>;
  reset: ReadonlySet<string>;
}

export function hasToolAccessFlags(flags: ToolAccessFlags): boolean {
  return (
    flags.read !== undefined ||
    flags.write !== undefined ||
    flags.tool.length > 0 ||
    flags.resetTool.length > 0
  );
}

function parseToolRule(raw: string): ToolRule | null {
  const parsed = toolRuleSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function parseToolFlag(raw: string): Result<[string, ToolRule], string> {
  const at = raw.lastIndexOf("=");
  const name = at > 0 ? raw.slice(0, at).trim() : "";
  const rule = at > 0 ? parseToolRule(raw.slice(at + 1).trim()) : null;
  if (name === "" || rule === null) {
    return err(`--tool takes <name>=${RULES_HINT}, not '${raw}'`);
  }
  return ok([name, rule]);
}

// UNIT_BOUNDARY_DESCRIPTION: reads the flags that change one Agent's tool access on an MCP Connection into one change, before the CLI asks the server anything. It answers null when no such flag was given, so the command only shows the access. A tool given twice, or given a rule and a reset at once, is refused, because the two flags would say different things.
export function parseToolAccessFlags(
  flags: ToolAccessFlags,
): Result<ToolAccessChange | null, string> {
  if (!hasToolAccessFlags(flags)) return ok(null);
  const read = flags.read === undefined ? undefined : parseToolRule(flags.read);
  if (read === null) return err(`--read takes ${RULES_HINT}`);
  const write =
    flags.write === undefined ? undefined : parseToolRule(flags.write);
  if (write === null) return err(`--write takes ${RULES_HINT}`);

  const tools = new Map<string, ToolRule>();
  for (const raw of flags.tool) {
    const parsed = parseToolFlag(raw);
    if (!parsed.ok) return parsed;
    const [name, rule] = parsed.value;
    const earlier = tools.get(name);
    if (earlier !== undefined && earlier !== rule) {
      return err(`--tool gives ${name} two rules: ${earlier} and ${rule}`);
    }
    tools.set(name, rule);
  }
  const reset = new Set(flags.resetTool.map((name) => name.trim()));
  if (reset.has("")) return err("--reset-tool takes a tool name");
  const both = [...reset].filter((name) => tools.has(name));
  if (both.length > 0) {
    return err(
      `--tool and --reset-tool both name ${both.join(", ")}; pass one of them`,
    );
  }
  return ok({
    ...(read !== undefined && { read }),
    ...(write !== undefined && { write }),
    tools,
    reset,
  });
}

export function changeToolAccess(
  current: GrantToolAccess,
  change: ToolAccessChange,
): GrantToolAccess {
  const overrides = new Map(Object.entries(current.overrides));
  for (const name of change.reset) overrides.delete(name);
  for (const [name, rule] of change.tools) overrides.set(name, rule);
  return {
    read: change.read ?? current.read,
    write: change.write ?? current.write,
    overrides: Object.fromEntries(overrides),
  };
}

function overrideOf(
  access: GrantToolAccess,
  name: string,
): ToolRule | undefined {
  return Object.hasOwn(access.overrides, name)
    ? access.overrides[name]
    : undefined;
}

export function ruleOfTool(
  access: GrantToolAccess,
  tool: ConnectionTool,
): ToolRule {
  return (
    overrideOf(access, tool.name) ??
    (tool.readOnly ? access.read : access.write)
  );
}

export function isException(
  access: GrantToolAccess,
  tool: ConnectionTool,
): boolean {
  return overrideOf(access, tool.name) !== undefined;
}

export function unlistedNames(
  names: Iterable<string>,
  tools: readonly ConnectionTool[] | null,
): string[] {
  if (tools === null) return [];
  const listed = new Set(tools.map((t) => t.name));
  return [...names].filter((name) => !listed.has(name));
}

export function writesWithoutAsking(
  access: GrantToolAccess,
  tools: readonly ConnectionTool[] | null,
): boolean {
  if (access.write === "allow") return true;
  const readTools = new Set(
    (tools ?? []).filter((t) => t.readOnly).map((t) => t.name),
  );
  return Object.entries(access.overrides).some(
    ([name, rule]) => rule === "allow" && !readTools.has(name),
  );
}

function verbOf(rule: ToolRule): string {
  switch (rule) {
    case "allow":
      return "allows";
    case "ask":
      return "asks before";
    case "block":
      return "blocks";
  }
}

function groupsPhrase(read: ToolRule, write: ToolRule): string {
  if (read === "allow" && write === "allow") return "allows everything";
  if (read === "allow" && write === "ask") return "asks before writing";
  if (read === "allow" && write === "block") return "read only";
  if (read === "ask" && write === "ask") return "asks before every tool";
  if (read === "block" && write === "block") return "blocks everything";
  return `${verbOf(read)} reads, ${verbOf(write)} writes`;
}

export function formatToolAccess(access: GrantToolAccess): string {
  const exceptions = Object.keys(access.overrides).length;
  const phrase = groupsPhrase(access.read, access.write);
  if (exceptions === 0) return phrase;
  return `${phrase}, ${exceptions} exception${exceptions === 1 ? "" : "s"}`;
}

export function toolAccessLines(access: GrantToolAccess): string[] {
  return [
    `  Read tools: ${access.read}`,
    `  Write tools and tools not in the list: ${access.write}`,
    ...Object.entries(access.overrides).map(
      ([name, rule]) => `  Exception: ${name} ${rule}`,
    ),
  ];
}

export function writesWithoutAskingNote(
  agentName: string,
  connectionName: string,
): string {
  return (
    `note: ${agentName} calls some tools of ${connectionName} that post or change things as you without asking, ` +
    `and so can anyone who can talk to ${agentName}; ` +
    `\`dam connection tools ${connectionName} --agent ${agentName}\` shows which ones\n`
  );
}
