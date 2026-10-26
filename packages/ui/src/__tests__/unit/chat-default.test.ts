// TEST_OVERVIEW: the release refuses a run whose chat default names no model, and the 0.2.23 configuration saves a model on the harness config alone. So a change to that model also writes the chat default, with the provider the model's qualified name names, and writes nothing when the value is a bare name, an unset, or a provider the agent does not hold.
import { describe, expect, it } from "vitest";

import { chatDefaultFor } from "../../modules/sessions/lib/chat-default.js";

const connections = [
  { id: "conn-ibm", templateId: "ibm-litellm" },
  { id: "conn-anthropic", templateId: "anthropic" },
  { id: "conn-openai", templateId: "openai" },
];

describe("the chat default behind the configuration's model", () => {
  // TEST_SCENARIO: Claude Code lists its models as `claude/<alias>/<id>` while the other harnesses name the alias first; both spellings reach the granted connection of that provider.
  it("writes the pair on the granted provider the model names", () => {
    expect(
      chatDefaultFor({
        harness: "claude-code",
        model: "claude/ibm/claude-opus-5",
        grantedConnectionIds: ["conn-ibm"],
        connections,
      }),
    ).toEqual({
      harness: "claude-code",
      provider: "conn-ibm",
      model: "claude/ibm/claude-opus-5",
    });
    expect(
      chatDefaultFor({
        harness: "codex",
        model: "openai/gpt-5.5",
        grantedConnectionIds: ["conn-openai"],
        connections,
      }),
    ).toEqual({
      harness: "codex",
      provider: "conn-openai",
      model: "openai/gpt-5.5",
    });
  });

  // TEST_SCENARIO: a bare tier word, an unset model and a provider the agent was never granted all leave the saved default alone, because the release refuses a routed default it cannot resolve rather than repairing it.
  it("writes nothing it cannot resolve to a granted provider", () => {
    expect(
      chatDefaultFor({
        harness: "claude-code",
        model: "sonnet",
        grantedConnectionIds: ["conn-ibm"],
        connections,
      }),
    ).toBeNull();
    expect(
      chatDefaultFor({
        harness: "claude-code",
        model: null,
        grantedConnectionIds: ["conn-ibm"],
        connections,
      }),
    ).toBeNull();
    expect(
      chatDefaultFor({
        harness: "claude-code",
        model: "claude/anthropic/claude-opus-5",
        grantedConnectionIds: ["conn-ibm"],
        connections,
      }),
    ).toBeNull();
  });
});
