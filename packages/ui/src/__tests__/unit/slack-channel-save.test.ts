// TEST_OVERVIEW: Setting up a Slack binding writes two things in order — the channel, then the profile its turns run on — and a dialog may not report the channel connected before that write finished. A profile write that fails is reported with the binding left in place, so the row can set it again, and a binding that names no profile writes only the channel.
import { describe, expect, it, vi } from "vitest";

import { saveSlackChannel } from "../../modules/sandboxes/lib/slack-channel-save.js";

describe("setting up a Slack channel", () => {
  /** TEST_SCENARIO: the channel is written, and only then is its profile, and the profile write is waited for. */
  it("writes the channel, then its profile", async () => {
    const order: string[] = [];
    const result = await saveSlackChannel({
      connect: async () => void order.push("channel"),
      setProfile: async () => void order.push("profile"),
    });
    expect(order).toEqual(["channel", "profile"]);
    expect(result).toBeNull();
  });

  /** TEST_SCENARIO: a profile that could not be set is reported, and the binding that was made is not undone. */
  it("reports a profile that could not be set", async () => {
    const failure = new Error(
      "That profile is not one this agent's owner holds",
    );
    const result = await saveSlackChannel({
      connect: async () => {},
      setProfile: async () => {
        throw failure;
      },
    });
    expect(result).toEqual({ profileError: failure });
  });

  /** TEST_SCENARIO: a binding with no profile writes nothing after the channel. */
  it("writes only the channel when it names no profile", async () => {
    const connect = vi.fn(async () => {});
    const result = await saveSlackChannel({ connect, setProfile: null });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });
});
