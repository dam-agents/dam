import { describe, expect, it } from "vitest";

import { planSlackChannelSave } from "../../modules/sandboxes/lib/slack-channel-save.js";

type Binding = { slackChannelId: string; ambient?: boolean };

const AGENT = "agent-1";
const bound = (slackChannelId: string, ambient?: boolean): Binding => ({
  slackChannelId,
  ...(ambient ? { ambient } : {}),
});

const plan = (
  channel: Binding | undefined,
  values: { channelId: string; ambient: boolean },
) => planSlackChannelSave({ agentId: AGENT, channel, values });

describe("planSlackChannelSave — connecting a new conversation", () => {
  it("connects the typed conversation, ambient off by default", () => {
    expect(plan(undefined, { channelId: "C-NEW", ambient: false })).toEqual({
      id: AGENT,
      slackChannelId: "C-NEW",
    });
  });

  it("carries the ambient opt-in", () => {
    expect(plan(undefined, { channelId: "C-NEW", ambient: true })).toEqual({
      id: AGENT,
      slackChannelId: "C-NEW",
      ambient: true,
    });
  });
});

describe("planSlackChannelSave — editing an existing binding", () => {
  it("writes nothing when ambient is unchanged", () => {
    expect(plan(bound("C-1"), { channelId: "C-1", ambient: false })).toBeNull();
    expect(
      plan(bound("C-1", true), { channelId: "C-1", ambient: true }),
    ).toBeNull();
  });

  it("flips ambient with a re-connect of the same conversation", () => {
    expect(plan(bound("C-1"), { channelId: "C-1", ambient: true })).toEqual({
      id: AGENT,
      slackChannelId: "C-1",
      ambient: true,
    });
    expect(
      plan(bound("C-1", true), { channelId: "C-1", ambient: false }),
    ).toEqual({ id: AGENT, slackChannelId: "C-1" });
  });

  // The conversation is a binding's identity — the edit form doesn't offer it,
  // and a save can't move a binding even if some other channel id reaches the
  // planner. Moving one is Connect + Disconnect, two deliberate acts (#2949).
  it("never connects a conversation other than the one being edited", () => {
    expect(plan(bound("C-1"), { channelId: "C-OTHER", ambient: true })).toEqual(
      {
        id: AGENT,
        slackChannelId: "C-1",
        ambient: true,
      },
    );
    expect(
      plan(bound("C-1", true), { channelId: "C-OTHER", ambient: true }),
    ).toBeNull();
  });
});
