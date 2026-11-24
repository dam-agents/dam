import type { ConnectionTool, GrantToolAccess, ToolRule } from "api-server-api";
import { match } from "ts-pattern";

export type ToolGroup = "read" | "write";

export type ListedTools = readonly ConnectionTool[] | null;

export type AccessTone = "writes" | "asks" | "quiet";

export interface AccessSummary {
  text: string;
  tone: AccessTone;
}

export interface GroupTool {
  name: string;
  listed: boolean;
}

export const TOOL_GROUP_TITLE: Record<ToolGroup, string> = {
  read: "Tools that read",
  write: "Tools that post or change",
};

export const TOOL_RULES: readonly ToolRule[] = ["allow", "ask", "block"];

// UNIT_BOUNDARY_DESCRIPTION: the tool's own rule, or undefined. It reads only the overrides' own keys, so a tool named like a built-in property of an object, such as `toString`, has no rule by accident.
export function overrideOf(
  access: GrantToolAccess,
  name: string,
): ToolRule | undefined {
  return Object.prototype.hasOwnProperty.call(access.overrides, name)
    ? access.overrides[name]
    : undefined;
}

// UNIT_BOUNDARY_DESCRIPTION: the group a tool belongs to. A tool is in the read group only where the stored list marks it as read only; a tool the list does not name is in the write group, as the gateway treats it.
export function toolGroupOf(name: string, tools: ListedTools): ToolGroup {
  return tools?.find((t) => t.name === name)?.readOnly ? "read" : "write";
}

export function toolRuleOf(
  access: GrantToolAccess,
  name: string,
  tools: ListedTools,
): ToolRule {
  return overrideOf(access, name) ?? access[toolGroupOf(name, tools)];
}

function isListed(name: string, tools: ListedTools): boolean {
  return (tools ?? []).some((t) => t.name === name);
}

// UNIT_BOUNDARY_DESCRIPTION: the tools that have their own rule but that the stored list does not name, because the list was never read, a read failed, or the server dropped the tool. The gateway still applies their rule, and they belong to the write group.
export function unlistedOverrides(
  access: GrantToolAccess,
  tools: ListedTools,
): readonly ConnectionTool[] {
  return Object.keys(access.overrides)
    .filter((name) => !isListed(name, tools))
    .map((name) => ({ name, readOnly: false }));
}

// UNIT_BOUNDARY_DESCRIPTION: the tools a group shows in the dialog: the listed tools of that group, and in the write group also every tool with its own rule that the list does not name.
export function toolsOfGroup(
  access: GrantToolAccess,
  tools: ListedTools,
  group: ToolGroup,
): readonly GroupTool[] {
  const listed = (tools ?? [])
    .filter((t) => (group === "read") === t.readOnly)
    .map(({ name }) => ({ name, listed: true }));
  if (group === "read") return listed;
  const unlisted = unlistedOverrides(access, tools).map(({ name }) => ({
    name,
    listed: false,
  }));
  return [...listed, ...unlisted];
}

export function exceptionsOf(
  access: GrantToolAccess,
  group: ToolGroup,
  tools: ListedTools,
): readonly { name: string; rule: ToolRule }[] {
  return toolsOfGroup(access, tools, group).flatMap(({ name }) => {
    const rule = overrideOf(access, name);
    return rule && rule !== access[group] ? [{ name, rule }] : [];
  });
}

function withoutOverridesLike(
  access: GrantToolAccess,
  tools: ListedTools,
): GrantToolAccess {
  const overrides = Object.fromEntries(
    Object.entries(access.overrides).filter(
      ([name, rule]) => rule !== access[toolGroupOf(name, tools)],
    ),
  );
  return { ...access, overrides };
}

// UNIT_BOUNDARY_DESCRIPTION: sets the rule of a whole group. A tool whose own rule now matches its group is no longer an exception, so it drops out of the overrides.
export function withGroupRule(
  access: GrantToolAccess,
  group: ToolGroup,
  rule: ToolRule,
  tools: ListedTools,
): GrantToolAccess {
  return withoutOverridesLike({ ...access, [group]: rule }, tools);
}

// UNIT_BOUNDARY_DESCRIPTION: sets the rule of one tool. A rule that differs from the tool's group is kept as an exception; the group's own rule removes the exception.
export function withToolRule(
  access: GrantToolAccess,
  name: string,
  rule: ToolRule,
  tools: ListedTools,
): GrantToolAccess {
  return withoutOverridesLike(
    { ...access, overrides: { ...access.overrides, [name]: rule } },
    tools,
  );
}

export function withoutException(
  access: GrantToolAccess,
  name: string,
): GrantToolAccess {
  const overrides = Object.fromEntries(
    Object.entries(access.overrides).filter(([tool]) => tool !== name),
  );
  return { ...access, overrides };
}

export function sameAccess(a: GrantToolAccess, b: GrantToolAccess): boolean {
  const names = new Set([
    ...Object.keys(a.overrides),
    ...Object.keys(b.overrides),
  ]);
  return (
    a.read === b.read &&
    a.write === b.write &&
    [...names].every((name) => overrideOf(a, name) === overrideOf(b, name))
  );
}

// UNIT_BOUNDARY_DESCRIPTION: whether a tool that does not read can run without asking, the same rule as the CLI's: the write group allows, so a tool the server adds later runs at once, or a tool that is not a listed read tool has its own allow.
export function writesWithoutAsking(
  access: GrantToolAccess,
  tools: ListedTools,
): boolean {
  if (access.write === "allow") return true;
  return Object.entries(access.overrides).some(
    ([name, rule]) => rule === "allow" && toolGroupOf(name, tools) === "write",
  );
}

interface Counts {
  readsAllowed: number;
  writesAllowed: number;
  asked: number;
  blocked: number;
}

function countRules(
  access: GrantToolAccess,
  tools: readonly ConnectionTool[],
  ruleOf: (tool: ConnectionTool) => ToolRule,
): Counts {
  const counts: Counts = {
    readsAllowed: 0,
    writesAllowed: 0,
    asked: 0,
    blocked: 0,
  };
  for (const tool of tools) {
    match(ruleOf(tool))
      .with("allow", () => {
        if (tool.readOnly) counts.readsAllowed++;
        else counts.writesAllowed++;
      })
      .with("ask", () => counts.asked++)
      .with("block", () => counts.blocked++)
      .exhaustive();
  }
  return counts;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function countParts(counts: Counts): string[] {
  const parts: string[] = [];
  if (counts.asked > 0)
    parts.push(`Asks before ${plural(counts.asked, "tool", "tools")}`);
  if (counts.writesAllowed > 0)
    parts.push(
      counts.writesAllowed === 1
        ? "1 writes without asking"
        : `${counts.writesAllowed} write without asking`,
    );
  if (counts.blocked > 0) parts.push(`${counts.blocked} blocked`);
  return parts;
}

function readPhrase(rule: ToolRule): string | null {
  return match(rule)
    .with("allow", () => null)
    .with("ask", () => "Asks before reading")
    .with("block", () => "Blocks reading")
    .exhaustive();
}

function writePhrase(rule: ToolRule): string {
  return match(rule)
    .with("allow", () => "Writes without asking")
    .with("ask", () => "Asks before writing")
    .with("block", () => "Blocks writing")
    .exhaustive();
}

const NEW_TOOLS_WRITE = "new tools write without asking";

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function joined(parts: readonly string[]): string {
  return capitalized(parts.join(" · "));
}

function groupCounts({ read, write }: GrantToolAccess): Counts {
  const rules = [read, write];
  return {
    readsAllowed: read === "allow" ? 1 : 0,
    writesAllowed: write === "allow" ? 1 : 0,
    asked: rules.filter((r) => r === "ask").length,
    blocked: rules.filter((r) => r === "block").length,
  };
}

// UNIT_BOUNDARY_DESCRIPTION: the summary of the two group rules alone, as before the tool list is read for the first time.
function groupText(access: GrantToolAccess): string {
  const named = namedSummary(access, groupCounts(access), 1, 1, 2);
  if (named) return named.text;
  return joined(
    [readPhrase(access.read), writePhrase(access.write)].filter(
      (part) => part !== null,
    ),
  );
}

const ALLOWS_EVERYTHING: AccessSummary = {
  text: "Allows everything",
  tone: "writes",
};
const BLOCKS_EVERYTHING: AccessSummary = {
  text: "Blocks everything",
  tone: "quiet",
};
const READ_ONLY: AccessSummary = { text: "Read only", tone: "quiet" };
const ASKS_BEFORE_WRITING: AccessSummary = {
  text: "Asks before writing",
  tone: "asks",
};

// UNIT_BOUNDARY_DESCRIPTION: the name of a common setting, or null. Only the write group's rule is checked beside the tools, because a tool the server adds later follows it.
function namedSummary(
  access: GrantToolAccess,
  counts: Counts,
  reads: number,
  writes: number,
  total: number,
): AccessSummary | null {
  const allReadsAllowed = counts.readsAllowed === reads;
  return match(access.write)
    .with("allow", () =>
      allReadsAllowed && counts.writesAllowed === writes
        ? ALLOWS_EVERYTHING
        : null,
    )
    .with("block", () => {
      if (counts.blocked === total) return BLOCKS_EVERYTHING;
      return allReadsAllowed && counts.blocked === writes ? READ_ONLY : null;
    })
    .with("ask", () =>
      allReadsAllowed && counts.asked === writes ? ASKS_BEFORE_WRITING : null,
    )
    .exhaustive();
}

function toneOf(
  access: GrantToolAccess,
  tools: ListedTools,
  asks: boolean,
): AccessTone {
  if (writesWithoutAsking(access, tools)) return "writes";
  return asks ? "asks" : "quiet";
}

// UNIT_BOUNDARY_DESCRIPTION: the summary where no tool is listed: the two group rules, then the tools whose own rule differs from the write group they fall in, since the gateway applies those rules all the same.
function unlistedSummary(access: GrantToolAccess): AccessSummary {
  const differing = unlistedOverrides(access, null).filter(
    (tool) => overrideOf(access, tool.name) !== access.write,
  );
  const counts = countRules(
    access,
    differing,
    (tool) => overrideOf(access, tool.name) ?? access.write,
  );
  const parts = countParts(counts);
  const groups = groupText(access);
  const text =
    parts.length === 0
      ? groups
      : `${groups}, except ${parts.join(" · ").replace(/^A/, "a")}`;
  const asks =
    access.read === "ask" || access.write === "ask" || counts.asked > 0;
  return { text, tone: toneOf(access, null, asks) };
}

// UNIT_BOUNDARY_DESCRIPTION: what one Agent may do with an MCP Connection, in a few words, and its tone: `writes` where a tool that does not read can run without asking, `asks` where a call waits for an answer, `quiet` otherwise. A common setting has its own name, such as "Read only" or "Asks before writing"; any other setting counts its tools. Every tool with its own rule counts, also one the list does not name, and the summary says so when only a tool the server adds later would write without asking.
export function accessSummary(
  access: GrantToolAccess,
  tools: ListedTools,
): AccessSummary {
  const listed = tools ?? [];
  if (listed.length === 0) return unlistedSummary(access);
  const counted = [...listed, ...unlistedOverrides(access, tools)];
  const reads = counted.filter((t) => t.readOnly).length;
  const counts = countRules(access, counted, (tool) =>
    toolRuleOf(access, tool.name, tools),
  );
  const named = namedSummary(
    access,
    counts,
    reads,
    counted.length - reads,
    counted.length,
  );
  if (named) return named;
  const tone = toneOf(access, tools, counts.asked > 0);
  const parts = countParts(counts);
  if (tone === "writes" && counts.writesAllowed === 0)
    parts.push(NEW_TOOLS_WRITE);
  if (parts.length === 0) return { text: groupText(access), tone };
  return { text: joined(parts), tone };
}

const TONE_RANK: Record<AccessTone, number> = { writes: 0, asks: 1, quiet: 2 };

export function byRisk(
  a: AccessSummary | undefined,
  b: AccessSummary | undefined,
): number {
  const rank = (s: AccessSummary | undefined) =>
    s ? TONE_RANK[s.tone] : Object.keys(TONE_RANK).length;
  return rank(a) - rank(b);
}
