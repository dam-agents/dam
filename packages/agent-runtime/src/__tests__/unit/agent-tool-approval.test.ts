/**
 * TEST_OVERVIEW: An agent holds one tool approval for all its sessions: ask,
 * auto or bypass. A session that picked no mode starts on the value the
 * harness's own option takes for it, before the catalog's default. The
 * session's own pick still wins. A choice that asks is left out where nobody
 * is there to answer, and a value the session's model cannot use is left out
 * too, so the session starts as it would with no agent approval. A harness
 * that keeps approval outside its mode gets no mode from it.
 */
import type { HarnessConfigCatalog, ToolApproval } from "agent-runtime-api";
import { describe, expect, it } from "vitest";
import {
  derivedMode,
  sessionSettingFrames,
  type SessionHarness,
} from "../../modules/acp/services/session-setting-frames.js";

const CLAUDE: HarnessConfigCatalog = {
  options: [
    {
      id: "mode",
      name: "Mode",
      category: "mode",
      default: "auto",
      choices: [
        { value: "auto", name: "Auto" },
        { value: "default", name: "Ask for approvals", needsApproval: true },
        { value: "acceptEdits", name: "Accept edits", needsApproval: true },
        { value: "plan", name: "Plan mode", needsApproval: true },
        { value: "bypassPermissions", name: "Bypass permissions" },
      ],
    },
  ],
  modelConstraints: {
    haiku: { mode: ["default", "acceptEdits", "plan", "bypassPermissions"] },
  },
};

const BOB: HarnessConfigCatalog = {
  options: [
    {
      id: "mode",
      name: "Mode",
      category: "mode",
      choices: [
        { value: "agent", name: "Agent" },
        { value: "ask", name: "Ask" },
      ],
    },
    {
      id: "approvals",
      name: "Approvals",
      category: "approvals",
      default: "auto",
      choices: [
        { value: "auto", name: "Auto-approve" },
        { value: "ask", name: "Ask every time", needsApproval: true },
      ],
    },
  ],
};

const claude = (): SessionHarness => ({
  catalog: CLAUDE,
  sessionSettings: { mode: { mode: true, deriveStartMode: true } },
  configured: () => ({ mode: null, model: null }),
});

const bob = (): SessionHarness => ({
  catalog: BOB,
  sessionSettings: {
    mode: { mode: true },
    approvals: { env: ["BOB_SESSION_APPROVALS"] },
  },
  configured: () => ({ mode: null, model: null }),
});

const startMode = (
  agentApproval: ToolApproval | null,
  opts: {
    settings?: Record<string, string>;
    model?: string;
    unattended?: boolean;
    harness?: SessionHarness;
  } = {},
) =>
  derivedMode({
    sessionId: "s",
    settings: opts.settings ?? {},
    model: opts.model ?? "ibm/claude-opus-4-5",
    native: false,
    harness: opts.harness ?? claude(),
    agentApproval,
    unattended: opts.unattended ?? false,
  });

describe("agent tool approval", () => {
  /** TEST_SCENARIO: The owner set the agent to bypass and the session picked nothing: the session starts in Claude Code's bypass mode, not in the catalog's auto. */
  it("starts a session that picked nothing on the agent's approval", () => {
    expect(startMode("bypass")).toBe("bypassPermissions");
    expect(startMode("ask")).toBe("acceptEdits");
    expect(startMode("auto")).toBe("auto");
  });

  /** TEST_SCENARIO: The agent holds no tool approval: the session starts on the catalog's default, as before the agent could hold one. */
  it("starts on the catalog's default when the agent holds none", () => {
    expect(startMode(null)).toBe("auto");
  });

  /** TEST_SCENARIO: The session picked its own mode in the chat: the agent's approval does not replace it, and the runtime derives nothing. */
  it("leaves a mode the session picked alone", () => {
    expect(startMode("bypass", { settings: { mode: "plan" } })).toBeNull();
    expect(
      sessionSettingFrames({
        sessionId: "s",
        settings: { mode: "plan" },
        model: "ibm/claude-opus-4-5",
        native: false,
        harness: claude(),
        agentApproval: "bypass",
      }),
    ).toEqual([
      {
        method: "session/set_mode",
        params: { sessionId: "s", modeId: "plan" },
      },
    ]);
  });

  /** TEST_SCENARIO: A channel turn or a schedule fire has nobody to answer a prompt: an agent set to ask leaves such a session on the catalog's default, and one set to bypass still bypasses. */
  it("skips a choice that asks where nobody is there to answer", () => {
    expect(startMode("ask", { unattended: true })).toBe("auto");
    expect(startMode("bypass", { unattended: true })).toBe("bypassPermissions");
  });

  /** TEST_SCENARIO: The session's model cannot use auto: an agent set to auto leaves the session on the first mode that model allows, and one set to bypass, which the model allows, bypasses. */
  it("skips a value the session's model cannot use", () => {
    expect(startMode("auto", { model: "ibm/haiku" })).toBe("default");
    expect(startMode("bypass", { model: "ibm/haiku" })).toBe(
      "bypassPermissions",
    );
  });

  /** TEST_SCENARIO: Bob keeps approval in a flag of its process and its mode is a persona: the agent's approval names no mode for it, so Bob stays on its own start mode. */
  it("names no mode for a harness that keeps approval outside its mode", () => {
    expect(startMode("ask", { harness: bob() })).toBeNull();
    expect(startMode("auto", { harness: bob() })).toBeNull();
  });
});
