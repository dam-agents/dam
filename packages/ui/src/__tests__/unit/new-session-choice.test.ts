// @vitest-environment happy-dom
// TEST_OVERVIEW: The composer's footer offers one control below the chat. A new session gets the pair picker once the agent reports the harnesses it carries, a loader while it still does, and the update notice instead when those harnesses predate the model router. With a session open it shows that session's model.
import type { HarnessCapability } from "agent-runtime-api";
import { expect, it } from "vitest";

import { newSessionChoice } from "../../modules/sessions/hooks/use-new-session-choice.js";

const pi: HarnessCapability = {
  name: "pi",
  harnessConfig: true,
  sessionModel: true,
  sessionSettings: ["mode"],
};

const choiceOf = (input: {
  status?: Parameters<typeof newSessionChoice>[0]["status"];
  statusPending?: boolean;
  sessionId?: string | null;
  sessionHarness?: string;
  operable?: boolean;
}) =>
  newSessionChoice({
    agentId: "agent",
    sessionId: input.sessionId ?? null,
    status: input.status,
    statusPending: input.statusPending ?? false,
    operable: input.operable ?? true,
    sessionHarness: input.sessionHarness,
  });

// TEST_SCENARIO: once the agent reports its harnesses, a new session starts on the picker, on the agent's default harness.
it("offers the picker for a new session the agent can route", () => {
  expect(
    choiceOf({ status: { harnesses: [pi], defaultHarness: "pi" } }).choice,
  ).toEqual({
    kind: "picker",
    agentId: "agent",
    carried: [pi],
    defaultHarness: "pi",
    routed: false,
  });
});

// TEST_SCENARIO: the picker starts on the harness the agent names as its default, and on the first one it carries when it names none.
it("starts on the agent's default harness", () => {
  const codex: HarnessCapability = { ...pi, name: "codex" };
  const picked = (defaultHarness?: string) => {
    const { choice } = choiceOf({
      status: {
        harnesses: [pi, codex],
        ...(defaultHarness && { defaultHarness }),
      },
    });
    return choice.kind === "picker" ? choice.defaultHarness : null;
  };
  expect(picked("codex")).toBe("codex");
  expect(picked()).toBe("pi");
});

// TEST_SCENARIO: the agent's harnesses arrive after its view, so the footer shows the picking control loading rather than nothing or a stale label.
it("offers the loading picker while the harnesses are still unknown", () => {
  expect(choiceOf({ statusPending: true }).choice).toEqual({
    kind: "pending",
    agentId: "agent",
  });
});

// TEST_SCENARIO: a harness that advertises a harness config without session settings is older than the model router, so the footer asks for a runtime update instead of offering a pair the runtime would ignore.
it("asks for an update when the harnesses predate the model router", () => {
  const older: HarnessCapability = {
    name: "pi",
    harnessConfig: true,
    sessionModel: true,
  };
  expect(choiceOf({ status: { harnesses: [older] } }).choice).toEqual({
    kind: "outdated",
    agentId: "agent",
  });
});

// TEST_SCENARIO: with a session open the footer names the model that session runs on, whatever the agent's harness list says.
it("shows an open session's model", () => {
  expect(choiceOf({ sessionId: "s1", sessionHarness: "pi" }).choice).toEqual({
    kind: "session",
    harness: "pi",
  });
});

// TEST_SCENARIO: an agent that cannot say which harness it carries leaves only the way to its defaults.
it("falls back to configuring defaults", () => {
  expect(choiceOf({}).choice).toEqual({ kind: "defaults", agentId: "agent" });
});

it("offers nothing without an agent", () => {
  expect(
    newSessionChoice({
      agentId: null,
      sessionId: null,
      status: undefined,
      statusPending: false,
      operable: true,
      sessionHarness: undefined,
    }).choice,
  ).toEqual({ kind: "nothing" });
});
