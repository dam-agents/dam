// @vitest-environment happy-dom
// TEST_OVERVIEW: A bound channel picks in the chat's own picker and stores both slots as it picks; a harness picked without a model waits on the row for its model, since a routed save refuses it.
import type { SessionChoiceReferences, SessionPair } from "api-server-api";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { ChannelProfileLine } from "../../modules/sandboxes/components/channels/channel-profile-line.js";

type Target = {
  slots: { pair: SessionPair | null };
  onChoose: (pair: SessionPair, references: SessionChoiceReferences) => void;
};

const state = vi.hoisted(() => ({
  target: null as Target | null,
  mutate: vi.fn(),
}));

vi.mock("../../modules/sessions/components/session-pair-picker.js", () => ({
  SessionPairPicker: (props: { target: Target }) => {
    state.target = props.target;
    return null;
  },
}));

vi.mock("../../modules/sandboxes/api/channel-profile.js", () => ({
  useSetChannelChoice: () => ({ mutate: state.mutate, isPending: false }),
}));

vi.mock("../../modules/agents/api/harness-config.js", () => ({
  useHarnessConfigStatus: () => ({
    data: { harnesses: [], defaultHarness: "claude-code", modelRouter: true },
  }),
}));

vi.mock("../../store.js", () => ({
  useStore: () => vi.fn(),
}));

describe("a bound channel's pick", () => {
  /** TEST_SCENARIO: a Custom selection that moves the channel to another harness holds the harness until its model is picked, then stores the pick with the subagent values the channel keeps, both references named. */
  it("waits for a model before it stores a new harness", () => {
    const own = {
      "platformSubagent.harness": "pi",
      "platformSubagent.model": "cb/haiku",
    };
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      act(() =>
        root.render(
          createElement(ChannelProfileLine, {
            agentId: "agent",
            channel: { type: "slack", slackChannelId: "C1" },
            slots: {
              profileId: null,
              pair: {
                harness: "claude-code",
                provider: null,
                model: "bedrock/opus",
              },
              platformSubagentProfileId: null,
              platformSubagentSettings: own,
            },
          }),
        ),
      );
      act(() =>
        state.target!.onChoose(
          { harness: "codex", provider: null, model: null },
          {},
        ),
      );
      expect(state.mutate).not.toHaveBeenCalled();
      expect(state.target!.slots.pair?.harness).toBe("codex");
      act(() =>
        state.target!.onChoose(
          {
            harness: "codex",
            provider: null,
            model: "openai/gpt-5.5",
            settings: { effort: "high" },
          },
          {},
        ),
      );
      expect(state.mutate).toHaveBeenCalledWith({
        type: "slack",
        slackChannelId: "C1",
        pair: {
          harness: "codex",
          provider: null,
          model: "openai/gpt-5.5",
          settings: { effort: "high", ...own },
        },
        profileId: null,
        platformSubagentProfileId: null,
      });
    } finally {
      act(() => root.unmount());
    }
  });
});
