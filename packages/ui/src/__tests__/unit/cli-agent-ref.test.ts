// TEST_OVERVIEW: a copied CLI command names its agent the way the CLI resolves it. A name works when exactly one agent carries it: plain names stay bare, any other name is single-quoted so bash, zsh and fish read it unchanged. A name shared by two agents, one shaped like an agent id, or one that would read as a flag uses the agent id instead.
import { describe, expect, it } from "vitest";

import { cliAgentRef } from "../../modules/sandboxes/lib/cli-agent-ref.js";

const ID = "agent-0123456789abcdef";
const ref = (name: string, others: string[] = []) =>
  cliAgentRef({ id: ID, name }, [
    { name },
    ...others.map((n) => ({ name: n })),
  ]);

describe("cliAgentRef", () => {
  // TEST_SCENARIO: letters, digits, `_` and `-` need no quoting in any of the three shells.
  it("leaves a plain unique name bare", () => {
    expect(ref("release-bot_2")).toBe("release-bot_2");
  });

  // TEST_SCENARIO: spaces and shell metacharacters are safe inside single quotes; a single quote closes the quotes, is escaped, and reopens them.
  it("single-quotes any other unique name", () => {
    expect(ref("my agent")).toBe("'my agent'");
    expect(ref("a$b;c")).toBe("'a$b;c'");
    expect(ref("bob's bot")).toBe("'bob'\\''s bot'");
  });

  // TEST_SCENARIO: the CLI refuses an ambiguous name, reads an id-shaped name as an id, and a leading dash as a flag, so all three use the id.
  it("falls back to the id when the name would not resolve to this agent", () => {
    expect(ref("twin", ["twin"])).toBe(ID);
    expect(ref("agent-fedcba9876543210")).toBe(ID);
    expect(ref("-x")).toBe(ID);
  });
});
