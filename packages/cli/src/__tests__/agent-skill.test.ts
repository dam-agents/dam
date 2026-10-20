import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Command, Option } from "commander";
import { describe, expect, it } from "vitest";
import { compose } from "../compose.js";
import * as exitCodes from "../modules/shared/exit-codes.js";

/**
 * TEST_OVERVIEW: The `dam` skill that users install into their own agent, so
 * that agent can drive DAM through this CLI. The skill lives next to the CLI
 * source and must not drift from it: every `dam …` command it names must
 * resolve to a real command in the program that `compose()` builds, every flag
 * on such a command must belong to that command, every flag it mentions on its
 * own must exist somewhere in the CLI, and its exit-code table must list
 * exactly the codes the CLI defines.
 */

const SKILL_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../skills/dam/SKILL.md",
);
const skill = readFileSync(SKILL_PATH, "utf-8");
const program = compose();

function tokenize(line: string): string[] {
  return line.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
}

function invocations(markdown: string): string[] {
  const found: string[] = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      if (/^dam(\s|$)/.test(line.trim())) found.push(line.trim());
      continue;
    }
    for (const match of line.matchAll(/`(dam(?:\s[^`]*)?)`/g)) {
      found.push(match[1]!);
    }
  }
  return found;
}

function standaloneFlags(markdown: string): string[] {
  const flags = new Set<string>();
  for (const match of markdown.matchAll(/`(--?[a-zA-Z][\w-]*)[^`]*`/g)) {
    flags.add(match[1]!);
  }
  return [...flags];
}

function findFlag(command: Command, flag: string): Option | undefined {
  return command.options.find((o) => o.long === flag || o.short === flag);
}

function knowsFlag(command: Command, flag: string): boolean {
  if (flag === "--help" || flag === "-h") return true;
  return findFlag(command, flag) !== undefined;
}

function allCommands(root: Command): Command[] {
  return [root, ...root.commands.flatMap(allCommands)];
}

function check(invocation: string): string | undefined {
  const [, ...tokens] = tokenize(invocation);
  let command = program;
  let positionals = 0;
  let valueFollows = false;
  for (const token of tokens) {
    if (valueFollows) {
      valueFollows = false;
      continue;
    }
    if (token.startsWith("-")) {
      const [flag, inlineValue] = token.split("=");
      if (!knowsFlag(command, flag!)) {
        return `\`${command.name()}\` has no flag ${flag}`;
      }
      const option = findFlag(command, flag!);
      valueFollows =
        inlineValue === undefined &&
        option !== undefined &&
        (option.required || option.optional);
      continue;
    }
    const sub = command.commands.find(
      (c) => c.name() === token || c.aliases().includes(token),
    );
    if (sub && positionals === 0) {
      command = sub;
      continue;
    }
    const placeholder = token.startsWith("<") && token.endsWith(">");
    const takesArguments = command.registeredArguments.length > 0;
    if (positionals === 0 && !placeholder && !takesArguments) {
      return `\`${command.name()}\` has no subcommand ${token}`;
    }
    positionals++;
  }
  return undefined;
}

describe("the dam skill", () => {
  /** TEST_SCENARIO: an agent copies these commands verbatim, so a renamed or removed command or flag must fail here before the skill ships with it. */
  it("names only commands and flags the CLI has", () => {
    const found = invocations(skill);
    expect(found.length).toBeGreaterThan(30);
    const broken = found
      .map((invocation) => ({ invocation, problem: check(invocation) }))
      .filter((r) => r.problem !== undefined);
    expect(broken).toEqual([]);
  });

  /** TEST_SCENARIO: prose such as "pass `--yes`" names a flag without its command, so each such flag must at least exist on some command. */
  it("mentions no flag that no command has", () => {
    const commands = allCommands(program);
    const unknown = standaloneFlags(skill).filter(
      (flag) => !commands.some((c) => knowsFlag(c, flag)),
    );
    expect(unknown).toEqual([]);
  });

  /** TEST_SCENARIO: an agent branches on exit codes from the skill's table, so the table must list each code the CLI defines and no other. */
  it("lists exactly the CLI's exit codes", () => {
    const listed = [...skill.matchAll(/^\|\s*(\d+)\s*\|/gm)].map((m) =>
      Number(m[1]),
    );
    const defined = [...new Set(Object.values(exitCodes))];
    expect([...listed].sort((a, b) => a - b)).toEqual(
      [...defined].sort((a, b) => a - b),
    );
  });

  /** TEST_SCENARIO: a self-check that the drift check can fail at all; a misspelt subcommand and a flag from another command must both be caught. */
  it("catches a command or flag the CLI lacks", () => {
    expect(check("dam agent creat my-agent")).toBeDefined();
    expect(check("dam agent create my-agent --cron 5")).toBeDefined();
    expect(check("dam auth login --server https://x.test")).toBeUndefined();
    expect(check("dam auth --server https://x.test login")).toBeDefined();
  });
});
