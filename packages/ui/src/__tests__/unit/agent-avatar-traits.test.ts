// TEST_OVERVIEW: An agent avatar is a robot head drawn from a seed. The same seed must always draw the same head, on every client and after every reload, and random seeds must be valid for the api-server to store.
import { agentAvatarSchema } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  randomAvatarSeed,
  randomAvatarSeeds,
} from "../../modules/agents/lib/avatar/random-seed.js";
import { avatarTraits } from "../../modules/agents/lib/avatar/traits.js";

describe("avatarTraits", () => {
  // TEST_SCENARIO: The agent list, the chat and the settings page each draw the avatar on their own. They must agree, so one seed gives one set of traits.
  it("draws the same head for the same seed", () => {
    expect(avatarTraits("k3v9x2qa")).toEqual(avatarTraits("k3v9x2qa"));
  });

  // TEST_SCENARIO: The picker offers five choices at once. Different seeds must give visibly different heads, not five copies of one design.
  it("varies the head across seeds", () => {
    const heads = new Set(
      Array.from({ length: 50 }, (_, i) =>
        JSON.stringify(avatarTraits(`s${i}`)),
      ),
    );
    expect(heads.size).toBe(50);
  });

  // TEST_SCENARIO: Bee stripes cover the face, so the eyes move up onto stalks. A striped head with no eyes would read as a blank robot.
  it("gives a striped face its eyes on stalks", () => {
    const striped = Array.from({ length: 300 }, (_, i) =>
      avatarTraits(`bee${i}`),
    ).filter((t) => t.face === "stripes");
    expect(striped.length).toBeGreaterThan(0);
    expect(striped.every((t) => t.top === "stalks")).toBe(true);
  });

  // TEST_SCENARIO: A chin plate covers the lower face, so a mouth there would be hidden or clash with it.
  it("drops the mouth when the head has a chin plate", () => {
    const chinned = Array.from({ length: 300 }, (_, i) =>
      avatarTraits(`chin${i}`),
    ).filter((t) => t.bottom === "chin");
    expect(chinned.length).toBeGreaterThan(0);
    expect(chinned.every((t) => t.mouth === "none")).toBe(true);
  });
});

describe("randomAvatarSeed", () => {
  // TEST_SCENARIO: The seed the picker offers is sent to agent create and update as is. The api-server must accept it.
  it("makes seeds the api-server accepts", () => {
    for (const seed of randomAvatarSeeds(20)) {
      expect(agentAvatarSchema.safeParse(seed).success).toBe(true);
    }
    expect(randomAvatarSeed()).not.toBe(randomAvatarSeed());
  });
});
