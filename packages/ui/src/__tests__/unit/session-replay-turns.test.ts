import { expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  handler: null as
    null | ((update: unknown, sid: string, frame: unknown) => void),
  state: {
    runStarts: [] as string[],
    setSessionModel: () => {},
    setRunStarts: () => {},
  },
  frames: [
    {
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "foreground" },
      },
      turnId: "fg",
    },
    {
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "background" },
      },
      turnId: "bg",
    },
    {
      update: {
        sessionUpdate: "platform_turn_ended",
        sessionId: "s",
        turnId: "bg",
      },
    },
  ],
}));
vi.mock("react", () => ({
  useCallback: (f: unknown) => f,
  useEffect: () => {},
  useRef: (value: unknown) => ({ current: value }),
  useState: (value: unknown) => [value, () => {}],
}));
vi.mock("../../store.js", () => ({ useStore: { getState: () => h.state } }));
vi.mock("../../modules/acp/utils.js", () => ({ RECONNECT_DELAYS: [0] }));
vi.mock("../../modules/sessions/api/acp-session-ops.js", () => ({
  handOverUndelivered: async () => {},
}));
vi.mock("../../modules/sessions/lib/undelivered-store.js", () => ({
  clearUndelivered: () => {},
  readUndelivered: () => [],
}));
vi.mock("../../modules/sessions/lib/prompt-delivery.js", () => ({
  withDeliveryTracking: (_delivery: unknown, handler: unknown) => handler,
}));
vi.mock("../../modules/acp/acp.js", () => ({
  openInitializedConnection: async (
    _agent: string,
    handler: typeof h.handler,
  ) => {
    h.handler = handler;
    return {
      ws: { addEventListener: () => {} },
      connection: {
        agent: {
          request: async (
            _method: string,
            params: { _meta: { platform: { loadToken: string } } },
          ) => {
            for (const frame of h.frames)
              h.handler!(frame.update, "s", {
                replayFor: params._meta.platform.loadToken,
                turnId: frame.turnId,
              });
            return { _meta: { platform: { turn: { inFlight: true } } } };
          },
        },
      },
    };
  },
}));

import { applyUpdate } from "../../modules/acp/session-projection.js";
import type { AcpUpdate } from "../../modules/acp/types.js";
import { useAcpConnection } from "../../modules/sessions/hooks/use-acp-connection.js";
import type { Message } from "../../types.js";

// TEST_SCENARIO: the retained runtime stamps every frame with its turn and keeps the stamp in the transcript it replays. A reload that drops the stamp merges a background reply into the foreground one and its named end then closes nothing, so the live chat and the reload disagree.
test("a reloaded history keeps the runtime's turn ids", async () => {
  const conn = useAcpConnection({
    selectedAgent: "a",
    sessionId: "s",
    sessionMode: null,
    liveBlocked: false,
    agentOperable: true,
    makeUpdateHandler: () => () => {},
    engage: async () => "s",
    bindEngagement: () => {},
    clearEngagement: () => {},
    setMessages: () => {},
    delivery: {} as never,
  });
  const replay = await conn.loadSessionHistory("s");
  const live = h.frames.reduce<Message[]>(
    (messages, frame) =>
      applyUpdate(
        messages,
        frame.update as AcpUpdate,
        undefined,
        undefined,
        frame.turnId,
      ),
    [],
  );
  const shown = (messages: Message[]) =>
    messages.map((m) => [m.turnId, m.parts, m.streaming]);
  expect(shown(replay)).toEqual(shown(live));
});
