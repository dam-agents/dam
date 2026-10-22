/**
 * TEST_OVERVIEW: Claude Code asks the server to check auto-mode actions on
 * every model call, and only a Claude model answers it. A Claude Code process
 * whose session runs a model that is not Claude, as its own model or its
 * subagent model, starts with the env its manifest declares for that case, so
 * it does not ask; a process on Claude models keeps the check. The shipped
 * Claude Code manifest turns the check off with CLAUDE_CODE_AUTO_MODE_SERVER.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { nonClaudeModelEnv } from "../../modules/acp/index.js";
import { loadManifest } from "../../modules/runtime-channel/manifest.js";

const here = dirname(fileURLToPath(import.meta.url));
const claudeManifest = loadManifest(
  join(here, "../../../../agents/claude-code/rootfs/app/runtime-manifest.yaml"),
);
const OFF = { CLAUDE_CODE_AUTO_MODE_SERVER: "0" };

describe("nonClaudeModelEnv", () => {
  /** TEST_SCENARIO: The IBM LiteLLM provider answers the check for its
   * Claude models and not for GPT, GLM or DeepSeek, whichever provider
   * serves them; Claude Code's own picker names spell the model with its
   * claude/ prefix. */
  it("gives the env to a session that runs a model that is not Claude", () => {
    for (const model of [
      "ibm/azure/gpt-5.5",
      "ibm/rits/deepseek-ai/deepseek-v3.2",
      "cb/rits/zai-org/glm-5-3",
      "claude/ibm/aws/gpt-6-luna",
    ])
      expect(nonClaudeModelEnv(OFF, [model]), model).toEqual(OFF);
  });

  /** TEST_SCENARIO: A session on a Claude model, on any provider, keeps the
   * check, and so does one with no model or a bare tier word, which runs on
   * Claude Code's own tiers. */
  it("gives no env to a session on Claude models", () => {
    for (const models of [
      ["ibm/aws/claude-opus-5-5"],
      ["anthropic/claude-sonnet-5-5"],
      ["claude/ibm/aws/claude-haiku-5-5"],
      [null],
      ["sonnet"],
      [],
    ])
      expect(nonClaudeModelEnv(OFF, models), String(models)).toBeUndefined();
  });

  /** TEST_SCENARIO: Subagent calls run in the session's process, so a
   * Claude session whose subagent model is not Claude gets the env too. */
  it("gives the env when only the subagent model is not Claude", () => {
    expect(
      nonClaudeModelEnv(OFF, ["ibm/aws/claude-opus-5-5", "ibm/azure/gpt-5.5"]),
    ).toEqual(OFF);
  });

  /** TEST_SCENARIO: A harness that declares no such env, as every one but
   * Claude Code, gets none, so its lease key does not change. */
  it("gives nothing for a harness that declares no env", () => {
    expect(nonClaudeModelEnv(undefined, ["ibm/azure/gpt-5.5"])).toBeUndefined();
    expect(nonClaudeModelEnv({}, ["ibm/azure/gpt-5.5"])).toBeUndefined();
  });

  /** TEST_SCENARIO: The shipped Claude Code manifest declares the variable
   * that stops Claude Code from asking for the server check. */
  it("is declared by the shipped Claude Code manifest", () => {
    expect(claudeManifest.modelRouter?.nonClaudeModelEnv).toEqual(OFF);
  });
});
