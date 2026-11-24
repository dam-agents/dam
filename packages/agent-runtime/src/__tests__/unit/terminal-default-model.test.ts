/**
 * TEST_OVERVIEW: The model a new web terminal opened with no model starts on:
 * the agent's chat default when it is on the terminal's harness and its
 * provider is granted, in the runtime's canonical spelling; otherwise none,
 * so the terminal starts on the harness's own default.
 */
import { describe, expect, it } from "vitest";
import { terminalDefaultModel } from "../../modules/terminal-default-model.js";

const opus = {
  harness: "pi",
  provider: "conn-ibm",
  model: "ibm/aws/claude-opus-5-5",
};
const everyProvider = () => true;

describe("terminalDefaultModel", () => {
  /** TEST_SCENARIO: The chip shows Opus 5.5 on Pi, so a Pi terminal opened with no model starts on Opus 5.5, not on the first model Pi's catalog lists. */
  it("starts a terminal on the chat default of its harness", () => {
    expect(
      terminalDefaultModel({
        harness: "pi",
        chatDefault: opus,
        granted: everyProvider,
      }),
    ).toBe("ibm/aws/claude-opus-5-5");
  });

  /** TEST_SCENARIO: A chat default on another harness says nothing about this one's models, and no chat default or one with no model gives nothing to start on: each leaves the terminal with no model. */
  it("gives no model for another harness's default, or none", () => {
    for (const chatDefault of [
      { ...opus, harness: "claude-code" },
      { ...opus, model: null },
      null,
      undefined,
    ])
      expect(
        terminalDefaultModel({
          harness: "pi",
          chatDefault,
          granted: everyProvider,
        }),
      ).toBeNull();
  });

  /** TEST_SCENARIO: A default whose provider the agent no longer holds would refuse the terminal with the provider-removed reason; the person opened it without a model, so it starts on the harness's own default instead. */
  it("gives no model whose provider is gone", () => {
    expect(
      terminalDefaultModel({
        harness: "pi",
        chatDefault: opus,
        granted: (model) => !model.startsWith("ibm/"),
      }),
    ).toBeNull();
  });

  /** TEST_SCENARIO: A default saved in Claude Code's spelling is the same model the runtime keeps under its canonical name, so the terminal's metadata names it the way a chat session's does. */
  it("names the model the way the runtime keeps it", () => {
    expect(
      terminalDefaultModel({
        harness: "claude-code",
        chatDefault: {
          ...opus,
          harness: "claude-code",
          model: "claude/ibm/aws/claude-opus-5-5",
        },
        granted: everyProvider,
      }),
    ).toBe("ibm/aws/claude-opus-5-5");
  });
});
