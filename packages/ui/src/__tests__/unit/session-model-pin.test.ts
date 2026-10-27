import { PIN_MODEL_METHOD } from "agent-runtime-api";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    sessionId: "s",
    sessionMode: null,
    messages: [],
    sessionModel: null as unknown,
    setSessionId: () => {},
    setMessages: () => {},
    setBusy: () => {},
    setSessionModel: (model: unknown) => {
      state.sessionModel = model;
    },
  };
  return { state, request: vi.fn(async () => ({ model: null })) };
});
vi.mock("react", () => ({
  useCallback: (f: unknown) => f,
  useEffect: () => {},
  useLayoutEffect: () => {},
  useRef: (value: unknown) => ({ current: value }),
  useState: (value: unknown) => [value, () => {}],
}));
vi.mock("../../store.js", () => ({
  useStore: Object.assign(
    (select: (s: typeof h.state) => unknown) => select(h.state),
    { getState: () => h.state },
  ),
}));
vi.mock("../../lib/toast.js", () => ({ emitToast: () => {} }));
vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgentRunState: () => null,
  useIsAgentOperable: () => true,
}));
vi.mock("../../modules/sessions/api/acp-session-ops.js", () => ({}));
vi.mock("../../modules/sessions/api/queries.js", () => ({}));
vi.mock("../../modules/sessions/lib/undelivered-store.js", () => ({}));
vi.mock("../../modules/sessions/hooks/use-acp-connection.js", () => ({
  useAcpConnection: () => ({
    connectionRef: {
      current: { connection: { agent: { request: h.request } } },
    },
  }),
}));
vi.mock("../../modules/sessions/hooks/use-acp-prompt.js", () => ({
  useAcpPrompt: () => ({}),
}));
vi.mock("../../modules/sessions/hooks/use-acp-session-engagement.js", () => ({
  useAcpSessionEngagement: () => ({}),
}));
vi.mock("../../modules/sessions/hooks/use-acp-update-handler.js", () => ({
  useAcpUpdateHandler: () => () => {},
}));

import { useAcpSession } from "../../modules/sessions/hooks/use-acp-session.js";
import { routedModelOf } from "../../modules/sessions/lib/session-model.js";

const choice = (value: string) => ({ value, name: value });

describe("pinning a session's model", () => {
  beforeEach(() => {
    h.request.mockClear();
    h.state.sessionModel = {
      sessionId: "s",
      configId: "model",
      current: "platform/ibm/aws/claude-opus-5-5",
      choices: [
        choice("platform/ibm/aws/claude-opus-5-5"),
        choice("platform/ibm/aws/claude-haiku-5-5"),
      ],
    };
  });

  // TEST_SCENARIO: each harness wraps the routed model id in its own option value: Claude Code as claude/<id>, Pi as platform/<id>, Codex not at all. The lease router pins the routed id and the Pi adapter adds platform/ itself, so a wrapped value sent as is reaches Pi as platform/platform/<id> and every turn fails.
  it("reads the routed model id out of each harness's option value", () => {
    expect(routedModelOf("claude/ibm/aws/claude-sonnet-5-5")).toBe(
      "ibm/aws/claude-sonnet-5-5",
    );
    expect(routedModelOf("platform/ibm/aws/claude-haiku-5-5")).toBe(
      "ibm/aws/claude-haiku-5-5",
    );
    expect(routedModelOf("ibm/aws/claude-opus-5-5")).toBe(
      "ibm/aws/claude-opus-5-5",
    );
    expect(routedModelOf("openai/gpt-6.1")).toBe("openai/gpt-6.1");
    expect(routedModelOf("opus")).toBe("opus");
  });

  // TEST_SCENARIO: a Pi session already broken by the doubled prefix stores platform/<id>; its chip and the choice the user switches back to still name the routed id, so the next pin repairs it.
  it("reads a doubled prefix as the routed id", () => {
    expect(routedModelOf("platform/platform/ibm/aws/claude-opus-5-5")).toBe(
      "ibm/aws/claude-opus-5-5",
    );
  });

  // TEST_SCENARIO: picking another model in a Pi chat pins the routed id, not Pi's option value, and the chip then shows the picked option.
  it("pins the routed id and shows the picked option", async () => {
    const session = useAcpSession("agent", { current: null });
    await session.chooseSessionModel("platform/ibm/aws/claude-haiku-5-5");
    expect(h.request).toHaveBeenCalledWith(PIN_MODEL_METHOD, {
      sessionId: "s",
      model: "ibm/aws/claude-haiku-5-5",
      follows: null,
    });
    expect(h.state.sessionModel).toMatchObject({
      current: "platform/ibm/aws/claude-haiku-5-5",
    });
  });
});
