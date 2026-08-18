import { describe, expect, it } from "vitest";
import { buildAppendAgentsMdCommand } from "../../modules/agents/index.js";

describe("buildAppendAgentsMdCommand", () => {
  it("appends to the harness-agnostic AGENTS.md instead of overwriting", () => {
    const command = buildAppendAgentsMdCommand("hello");
    expect(command).toContain('>> "$HOME/.agents/AGENTS.md"');
    expect(command).not.toMatch(/[^>]> /);
  });

  it("links CLAUDE.md to AGENTS.md only when nothing is there yet", () => {
    const command = buildAppendAgentsMdCommand("hello");
    expect(command).toContain(
      '[ -e "$HOME/.claude/CLAUDE.md" ] || ln -s "$HOME/.agents/AGENTS.md" "$HOME/.claude/CLAUDE.md"',
    );
  });

  it("creates the directories before writing", () => {
    const command = buildAppendAgentsMdCommand("hello");
    const mkdirAt = command.indexOf('mkdir -p "$HOME/.agents" "$HOME/.claude"');
    const writeAt = command.indexOf("printf");
    expect(mkdirAt).toBeGreaterThan(-1);
    expect(writeAt).toBeGreaterThan(mkdirAt);
  });

  it("stays a single line regardless of section newlines", () => {
    const command = buildAppendAgentsMdCommand("line one\nline two");
    expect(command).not.toContain("\n");
    expect(command).toContain("'line one'");
    expect(command).toContain("'line two'");
  });

  it("escapes single quotes in the section", () => {
    const command = buildAppendAgentsMdCommand("it's");
    expect(command).toContain(`'it'\\''s'`);
  });
});
