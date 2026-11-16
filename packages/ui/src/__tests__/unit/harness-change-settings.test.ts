// TEST_OVERVIEW: A harness change in the session picker keeps only the settings the new harness offers, and carries effort by what it is rather than its key: Claude Code keeps effort as `effort` and tool approval as `mode`, Pi keeps effort as `mode`, so a key copied as it is would be refused or mean something else.
import type { HarnessCapability } from "agent-runtime-api";
import { sessionSettingsError } from "agent-runtime-api";
import { describe, expect, it } from "vitest";

import {
  harnessChangeSettings,
  offeredSettings,
  settingsForModel,
} from "../../modules/sessions/lib/session-settings.js";

const pi: HarnessCapability = {
  name: "pi",
  harnessConfig: true,
  sessionModel: true,
  sessionSettings: ["mode"],
  harnessConfigCatalog: {
    options: [
      { id: "model", name: "Model", category: "model", choices: [] },
      {
        id: "mode",
        name: "Thinking",
        category: "thought_level",
        default: "medium",
        choices: ["off", "minimal", "low", "medium", "high", "xhigh"].map(
          (value) => ({ value, name: value }),
        ),
      },
    ],
  },
};

const claudeCode: HarnessCapability = {
  name: "claude-code",
  harnessConfig: true,
  sessionModel: true,
  sessionSettings: [
    "mode",
    "effort",
    "cacheTtl",
    "subagentModel",
    "subagentEffort",
  ],
  harnessConfigCatalog: {
    modelConstraints: {
      haiku: {
        mode: [
          "default",
          "acceptEdits",
          "plan",
          "dontAsk",
          "bypassPermissions",
        ],
        effort: [],
        subagentEffort: [],
      },
    },
    options: [
      { id: "model", name: "Model", category: "model", choices: [] },
      {
        id: "subagentModel",
        name: "Subagent model",
        category: "model",
        subagents: true,
        choices: [],
      },
      {
        id: "mode",
        name: "Mode",
        category: "mode",
        default: "auto",
        choices: ["auto", "default", "acceptEdits", "bypassPermissions"].map(
          (value) => ({ value, name: value }),
        ),
      },
      {
        id: "effort",
        name: "Effort",
        category: "thought_level",
        default: "medium",
        choices: ["low", "medium", "high", "xhigh"].map((value) => ({
          value,
          name: value,
        })),
      },
      {
        id: "subagentEffort",
        name: "Subagent effort",
        category: "thought_level",
        subagents: true,
        choices: ["low", "medium", "high", "xhigh"].map((value) => ({
          value,
          name: value,
        })),
      },
      {
        id: "cacheTtl",
        name: "Prompt cache",
        category: "cache",
        default: "5m",
        choices: ["5m", "1h"].map((value) => ({ value, name: value })),
      },
    ],
  },
};

/* UNIT_BOUNDARY_DESCRIPTION: what the chat default's save and the runtime ask of a harness's settings: each key one it offers per session, with a value it accepts for the model. */
const refused = (
  harness: HarnessCapability,
  settings: Record<string, string>,
  model: string,
) =>
  Object.keys(settings).find(
    (id) =>
      !id.startsWith("platformSubagent.") &&
      !harness.sessionSettings?.includes(id),
  ) ??
  sessionSettingsError(harness.harnessConfigCatalog, settings, model) ??
  null;

describe("a harness change", () => {
  /** TEST_SCENARIO: Claude Code High becomes Pi High; tool approval and the prompt cache, which Pi has no setting for, are dropped, and the platform sub-agent slot stays. */
  it("carries effort from Claude Code to Pi under Pi's key", () => {
    const next = harnessChangeSettings(claudeCode, pi, {
      effort: "high",
      mode: "bypassPermissions",
      cacheTtl: "1h",
      subagentEffort: "low",
      "platformSubagent.harness": "pi",
      "platformSubagent.model": "ibm/aws/claude-opus-5-5",
    });
    expect(next).toEqual({
      mode: "high",
      "platformSubagent.harness": "pi",
      "platformSubagent.model": "ibm/aws/claude-opus-5-5",
    });
    expect(refused(pi, next, "ibm/aws/claude-opus-5-5")).toBeNull();
  });

  /** TEST_SCENARIO: Pi High becomes Claude Code High, and Pi's `mode` never lands in Claude Code's tool approval, where `high` means nothing. */
  it("carries effort from Pi to Claude Code, never as tool approval", () => {
    const next = harnessChangeSettings(pi, claudeCode, { mode: "high" });
    expect(next).toEqual({ effort: "high" });
    expect(refused(claudeCode, next, "ibm/aws/claude-opus-5-5")).toBeNull();
  });

  /** TEST_SCENARIO: an effort level the new harness lacks (Pi's Off) is dropped, so the new harness starts on its own default. */
  it("drops an effort level the new harness does not have", () => {
    expect(harnessChangeSettings(pi, claudeCode, { mode: "off" })).toEqual({});
  });

  /** TEST_SCENARIO: Pi → Claude Code → Pi → Claude Code keeps High all the way, and every step is one the chat default's save accepts. */
  it("round-trips effort across repeated switches", () => {
    let settings: Record<string, string> = { mode: "high" };
    let from = pi;
    for (const to of [claudeCode, pi, claudeCode, pi]) {
      settings = settingsForModel(
        to,
        [],
        "ibm/aws/claude-opus-5-5",
        harnessChangeSettings(from, to, settings),
      );
      expect(refused(to, settings, "ibm/aws/claude-opus-5-5")).toBeNull();
      expect(settings).toEqual(
        to === pi ? { mode: "high" } : { effort: "high" },
      );
      from = to;
    }
  });

  /** TEST_SCENARIO: carried effort the new model cannot take (Haiku 4.5 has no effort levels) is dropped by the model's constraints. */
  it("drops carried effort the new model cannot take", () => {
    expect(
      settingsForModel(
        claudeCode,
        [],
        "haiku",
        harnessChangeSettings(pi, claudeCode, { mode: "high" }),
      ),
    ).toEqual({});
  });
});

describe("a session that already holds another harness's key", () => {
  /** TEST_SCENARIO: a Claude Code session left with Pi's `mode=high` keeps neither it nor a stray key on its next pick; its own valid values stay. */
  it("drops Pi's mode=high on Claude Code", () => {
    expect(
      offeredSettings(claudeCode, {
        mode: "high",
        effort: "low",
        cacheTtl: "1h",
      }),
    ).toEqual({ effort: "low", cacheTtl: "1h" });
  });

  /** TEST_SCENARIO: a Pi session left with Claude Code's `effort` drops it, and keeps its own thinking level. */
  it("drops Claude Code's effort on Pi", () => {
    expect(
      settingsForModel(pi, [], "ibm/aws/claude-opus-5-5", {
        effort: "high",
        mode: "low",
      }),
    ).toEqual({ mode: "low" });
  });

  /** TEST_SCENARIO: a harness with no catalog yet cannot be judged, so its settings stay as they are. */
  it("keeps everything when the harness has no catalog", () => {
    expect(offeredSettings(undefined, { effort: "high" })).toEqual({
      effort: "high",
    });
  });
});
