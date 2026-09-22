// TEST_OVERVIEW: An agent avatar is a robot head drawn from a hash of the agent's name, so nothing is stored. The same name must always draw the same head on every client, and every eye variation must fit inside every head shape.
import { describe, expect, it } from "vitest";

import { HEAD_GEOMETRY } from "../../modules/agents/lib/avatar/geometry.js";
import { eyeScale } from "../../modules/agents/lib/avatar/layout.js";
import {
  avatarTraits,
  derpEyes,
  DERPS,
  HEAD_SHAPES,
} from "../../modules/agents/lib/avatar/traits.js";

const NAMES = Array.from({ length: 400 }, (_, i) => `agent-${i}`);

describe("avatarTraits", () => {
  // TEST_SCENARIO: The agents list, the chat and the Home feed each draw the avatar on their own from the agent's name. They must agree, so one name gives one set of traits.
  it("draws the same head for the same name", () => {
    expect(avatarTraits("velvet-comet")).toEqual(avatarTraits("velvet-comet"));
  });

  // TEST_SCENARIO: A user with a dozen agents tells them apart at a glance, so different names must give different heads.
  it("varies the head across names", () => {
    const heads = new Set(
      NAMES.slice(0, 50).map((name) => JSON.stringify(avatarTraits(name))),
    );
    expect(heads.size).toBe(50);
  });

  // TEST_SCENARIO: Most heads carry sclera eyes, and every derpy variation shows up across a realistic spread of names.
  it("favours sclera eyes and uses every eye variation", () => {
    const traits = NAMES.map(avatarTraits);
    const withEyes = traits.filter((t) => t.face === "eyes");
    expect(withEyes.length / traits.length).toBeGreaterThan(0.5);
    expect(new Set(withEyes.map((t) => t.derp))).toEqual(new Set(DERPS));
  });

  // TEST_SCENARIO: Bee stripes cover the face, so the eyes move up onto stalks. A striped head with no eyes would read as a blank robot.
  it("gives a striped face its eyes on stalks", () => {
    const striped = NAMES.map(avatarTraits).filter((t) => t.face === "stripes");
    expect(striped.length).toBeGreaterThan(0);
    expect(striped.every((t) => t.top === "stalks")).toBe(true);
  });

  // TEST_SCENARIO: A mouth is drawn below the eyes. A chin plate or a low eye would cover it, so the head then goes without one.
  it("drops the mouth when a chin plate or a low eye leaves no room", () => {
    for (const t of NAMES.map(avatarTraits)) {
      if (t.mouth === "none") continue;
      expect(t.bottom).not.toBe("chin");
      expect(Math.max(...t.eyes.map((e) => e.y + e.r))).toBeLessThan(62);
    }
  });
});

describe("derpEyes", () => {
  // TEST_SCENARIO: Eyes are clipped to the head. An eye that reached past the head's edge would be cut off and read as a rendering bug, not a deliberate derp. A pupil looks at most a full step in any direction, so it never leaves its eye.
  it("keeps every eye variation inside every head shape", () => {
    let state = 0;
    const random = () => (state = (state * 9301 + 49297) % 233280) / 233280;
    for (const shape of HEAD_SHAPES) {
      const head = HEAD_GEOMETRY[shape];
      for (const derp of DERPS) {
        for (let i = 0; i < 20; i++) {
          for (const e of derpEyes(derp, random)) {
            const x = e.x * eyeScale(head);
            expect(Math.abs(x) + e.r).toBeLessThanOrEqual(head.halfWidth);
            expect(e.y - e.r).toBeGreaterThanOrEqual(head.top + 4);
            expect(e.y + e.r).toBeLessThanOrEqual(head.bottom - 4);
            expect(Math.hypot(e.look.dx, e.look.dy)).toBeLessThanOrEqual(
              1 + 1e-9,
            );
          }
        }
      }
    }
  });
});
