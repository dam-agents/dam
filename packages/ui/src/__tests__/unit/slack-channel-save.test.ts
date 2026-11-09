import { describe, expect, it } from "vitest";

import { planSlackChannelSave } from "../../modules/sandboxes/lib/slack-channel-save.js";

type Binding = {
  slackChannelId: string;
  ambient?: boolean;
  history?: boolean;
  customEmoji?: string[] | null;
};

const AGENT = "agent-1";
const bound = (slackChannelId: string, ambient?: boolean): Binding => ({
  slackChannelId,
  ...(ambient ? { ambient } : {}),
});

const plan = (
  channel: Binding | undefined,
  values: {
    channelId: string;
    ambient: boolean;
    history?: boolean;
    customEmoji?: string[] | null;
  },
) =>
  planSlackChannelSave({
    agentId: AGENT,
    channel,
    values: { history: false, ...values },
  });

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

describe("planSlackChannelSave — channel history", () => {
  it("carries the history opt-in on a new connection", () => {
    expect(
      plan(undefined, { channelId: "C-NEW", ambient: false, history: true }),
    ).toEqual({ id: AGENT, slackChannelId: "C-NEW", history: true });
  });

  it("keeps history on when only ambient changes, since a re-connect writes both", () => {
    const withHistory = { slackChannelId: "C-1", history: true };
    expect(
      plan(withHistory, { channelId: "C-1", ambient: true, history: true }),
    ).toEqual({
      id: AGENT,
      slackChannelId: "C-1",
      ambient: true,
      history: true,
    });
  });

  it("writes nothing when history is unchanged, and turns it off with a re-connect", () => {
    const withHistory = { slackChannelId: "C-1", history: true };
    expect(
      plan(withHistory, { channelId: "C-1", ambient: false, history: true }),
    ).toBeNull();
    expect(
      plan(withHistory, { channelId: "C-1", ambient: false, history: false }),
    ).toEqual({ id: AGENT, slackChannelId: "C-1" });
  });
});

describe("planSlackChannelSave — custom emoji", () => {
  const names = Array.from({ length: 8 }, (_, i) => `dam-agent-${i + 1}`);

  it("carries the names on a new connection", () => {
    expect(
      plan(undefined, {
        channelId: "C-NEW",
        ambient: false,
        customEmoji: names,
      }),
    ).toEqual({ id: AGENT, slackChannelId: "C-NEW", customEmoji: names });
  });

  it("writes changed names, clears them, and skips an unchanged set", () => {
    const withNames = { slackChannelId: "C-1", customEmoji: names };
    const renamed = names.map((n) => `x-${n}`);
    expect(
      plan(bound("C-1"), {
        channelId: "C-1",
        ambient: false,
        customEmoji: names,
      }),
    ).toEqual({ id: AGENT, slackChannelId: "C-1", customEmoji: names });
    expect(
      plan(withNames, {
        channelId: "C-1",
        ambient: false,
        customEmoji: renamed,
      }),
    ).toEqual({ id: AGENT, slackChannelId: "C-1", customEmoji: renamed });
    expect(
      plan(withNames, { channelId: "C-1", ambient: false, customEmoji: null }),
    ).toEqual({ id: AGENT, slackChannelId: "C-1", customEmoji: null });
    expect(
      plan(withNames, { channelId: "C-1", ambient: false, customEmoji: names }),
    ).toBeNull();
  });
});
