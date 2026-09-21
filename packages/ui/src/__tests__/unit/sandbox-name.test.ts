// TEST_OVERVIEW: the name the create form pre-fills. The first agent is called
// TEST_OVERVIEW: "agent", and later ones count up from 2. An agent created from a
// TEST_OVERVIEW: starter kit is named after the kit instead, and numbers the same way,
// TEST_OVERVIEW: so two agents from one kit never arrive with the same name.
import { describe, expect, test } from "vitest";

import {
  nextSandboxName,
  sandboxNameBase,
} from "../../modules/agents/lib/sandbox-name.js";

describe("sandboxNameBase", () => {
  test("names an agent after the product, not after one type of agent", () => {
    expect(sandboxNameBase("coding-agent")).toBe("agent");
  });

  test("names an agent from a kit after that kit", () => {
    expect(sandboxNameBase("starter-kit", "code-reviewer")).toBe(
      "code-reviewer",
    );
  });

  // TEST_SCENARIO: the kit is resolved by a query, so the form renders once before the kit id arrives. Until it does, the generic base has to do.
  test("falls back to the generic base until the kit is known", () => {
    expect(sandboxNameBase("starter-kit", null)).toBe("agent");
    expect(sandboxNameBase("starter-kit", "   ")).toBe("agent");
  });

  test("keeps experiments on their own word", () => {
    expect(sandboxNameBase("experiment")).toBe("experiment");
  });
});

describe("nextSandboxName", () => {
  test("leaves the first one unnumbered", () => {
    expect(nextSandboxName("agent", [])).toBe("agent");
  });

  test("starts counting at 2 once the bare name is taken", () => {
    expect(nextSandboxName("agent", ["agent"])).toBe("agent-2");
    expect(nextSandboxName("agent", ["agent", "agent-2"])).toBe("agent-3");
  });

  // TEST_SCENARIO: names are compared without case or surrounding space, because a user who typed "Agent " earlier would otherwise be offered the same name again.
  test("treats a name as taken whatever its case or spacing", () => {
    expect(nextSandboxName("agent", ["  Agent "])).toBe("agent-2");
  });

  // TEST_SCENARIO: deleting agent-2 leaves a gap. The suggestion fills it rather than counting past it, so numbers stay small.
  test("fills the lowest free number", () => {
    expect(nextSandboxName("agent", ["agent", "agent-3"])).toBe("agent-2");
  });

  // TEST_SCENARIO: an unrelated agent whose name merely starts with the base must not push the count up.
  test("ignores names that only begin with the base", () => {
    expect(nextSandboxName("agent", ["agent-smith", "agentic"])).toBe("agent");
  });

  test("numbers kit names the same way", () => {
    expect(nextSandboxName("code-reviewer", ["code-reviewer"])).toBe(
      "code-reviewer-2",
    );
  });
});
