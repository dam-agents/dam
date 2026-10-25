// TEST_OVERVIEW: Picking a profile for a channel. A profile the agent can run is saved as it is; one whose provider the owner holds and the agent has not been granted is attached first, exactly as the chat picker's "Connect this provider" does, and is saved only when that attach worked — so a channel never names a profile whose every later turn would be refused.
import type { ProfileWithUsage } from "api-server-api";
import { describe, expect, it, vi } from "vitest";

import { saveChannelProfile } from "../../modules/sandboxes/lib/channel-profile-save.js";

const profile = (
  availability: ProfileWithUsage["availability"],
): ProfileWithUsage => ({
  id: "p1",
  name: "Default",
  harness: "claude-code",
  providerTemplate: "curve-bender-deployment",
  model: "cb/rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
  settings: {},
  seeded: true,
  createdAt: "",
  updatedAt: "",
  usage: { agents: 0, channels: 0, schedules: 0 },
  availability,
});

const available: ProfileWithUsage["availability"] = {
  available: true,
  reason: null,
  attachable: false,
};
const attachable: ProfileWithUsage["availability"] = {
  available: true,
  reason: null,
  attachable: true,
};

describe("picking a channel's profile", () => {
  /** TEST_SCENARIO: a profile the agent can run is saved without touching the
   * agent's grants. */
  it("saves a profile the agent can run", async () => {
    const attach = vi.fn(async () => true);
    const save = vi.fn();
    await saveChannelProfile({ profile: profile(available), attach, save });
    expect(attach).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith("p1");
  });

  /** TEST_SCENARIO: a profile whose provider the agent has not been granted is
   * attached first and then saved, so the turn it runs on can run. */
  it("attaches the provider first, then saves", async () => {
    const attach = vi.fn(async () => true);
    const save = vi.fn();
    await saveChannelProfile({ profile: profile(attachable), attach, save });
    expect(attach).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("p1");
  });

  /** TEST_SCENARIO: an attach that failed saves nothing, so no channel names a
   * profile its turns would refuse. */
  it("saves nothing when the attach failed", async () => {
    const attach = vi.fn(async () => false);
    const save = vi.fn();
    await saveChannelProfile({ profile: profile(attachable), attach, save });
    expect(save).not.toHaveBeenCalled();
  });
});
