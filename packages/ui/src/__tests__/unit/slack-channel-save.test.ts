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
  it("connects it, ambient off by default", () => {
    expect(plan(undefined, { channelId: "C-NEW", ambient: false })).toEqual([
      { kind: "connect", input: { id: AGENT, slackChannelId: "C-NEW" } },
    ]);
  });

  it("carries the ambient opt-in", () => {
    expect(plan(undefined, { channelId: "C-NEW", ambient: true })).toEqual([
      {
        kind: "connect",
        input: { id: AGENT, slackChannelId: "C-NEW", ambient: true },
      },
    ]);
  });
});

describe("planSlackChannelSave — editing an existing binding", () => {
  it("writes nothing when neither the conversation nor ambient changed", () => {
    expect(plan(bound("C-1"), { channelId: "C-1", ambient: false })).toEqual(
      [],
    );
    expect(
      plan(bound("C-1", true), { channelId: "C-1", ambient: true }),
    ).toEqual([]);
  });

  it("flips ambient with a same-conversation re-connect, never a disconnect", () => {
    expect(plan(bound("C-1"), { channelId: "C-1", ambient: true })).toEqual([
      {
        kind: "connect",
        input: { id: AGENT, slackChannelId: "C-1", ambient: true },
      },
    ]);
    expect(
      plan(bound("C-1", true), { channelId: "C-1", ambient: false }),
    ).toEqual([
      { kind: "connect", input: { id: AGENT, slackChannelId: "C-1" } },
    ]);
  });
});

describe("planSlackChannelSave — moving a binding (#2949)", () => {
  it("connects the new conversation before releasing the old one", () => {
    expect(
      plan(bound("C-OLD"), { channelId: "C-NEW", ambient: false }),
    ).toEqual([
      { kind: "connect", input: { id: AGENT, slackChannelId: "C-NEW" } },
      { kind: "disconnect", input: { id: AGENT, slackChannelId: "C-OLD" } },
    ]);
  });

  it("never leads with a release — a refused connect must keep the binding", () => {
    const steps = plan(bound("C-OLD", true), {
      channelId: "C-NEW",
      ambient: true,
    });
    expect(steps[0]).toEqual({
      kind: "connect",
      input: { id: AGENT, slackChannelId: "C-NEW", ambient: true },
    });
    expect(steps.filter((s) => s.kind === "disconnect")).toHaveLength(1);
  });

  it("releases only the conversation being moved, not the agent's others", () => {
    const steps = plan(bound("C-OLD"), { channelId: "C-NEW", ambient: false });
    const released = steps.filter((s) => s.kind === "disconnect");
    expect(released).toEqual([
      { kind: "disconnect", input: { id: AGENT, slackChannelId: "C-OLD" } },
    ]);
  });
});
