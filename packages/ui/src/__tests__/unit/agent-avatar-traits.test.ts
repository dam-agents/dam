// TEST_OVERVIEW: An agent avatar is a figure drawn from a hash of the agent's name, so nothing is stored. The same name must always draw the same figure; its parts mix freely across head shapes; and no eye or visor may sit on a gap between parts, or reach past the head.
import { describe, expect, it } from "vitest";

import { HEAD_GEOMETRY } from "../../modules/agents/lib/avatar/geometry.js";
import {
  bugEyeCenter,
  gapRanges,
  placeEyes,
  visorBox,
} from "../../modules/agents/lib/avatar/layout.js";
import {
  AVATAR_GAP,
  type AvatarTraits,
  avatarTraits,
  DERPS,
} from "../../modules/agents/lib/avatar/traits.js";

const NAMES = Array.from({ length: 1000 }, (_, i) => `agent-${i}`);
const ALL = NAMES.map((name) => ({ name, traits: avatarTraits(name) }));

function overlaps(top: number, bottom: number, traits: AvatarTraits) {
  const head = HEAD_GEOMETRY[traits.head];
  return gapRanges(traits, head).some(
    (gap) => top < gap.bottom && bottom > gap.top,
  );
}

describe("avatarTraits", () => {
  // TEST_SCENARIO: The agents list, the chat and the Home feed each draw the avatar on their own from the agent's name. They must agree, so one name gives one figure.
  it("draws the same figure for the same name", () => {
    expect(avatarTraits("velvet-comet")).toEqual(avatarTraits("velvet-comet"));
  });

  // TEST_SCENARIO: A user with a dozen agents tells them apart at a glance, so different names must give different figures.
  it("varies the figure across names", () => {
    const figures = new Set(
      ALL.slice(0, 50).map(({ traits }) => JSON.stringify(traits)),
    );
    expect(figures.size).toBe(50);
  });

  // TEST_SCENARIO: Parts are mixed and matched rather than bundled into fixed types. Bee parts turn up on robot heads and robot parts on the bee's capsule body.
  it("mixes parts freely across head shapes", () => {
    const pairs = new Set(
      ALL.flatMap(({ traits: t }) => [
        `${t.head}:${t.sides}`,
        `${t.head}:${t.top}`,
        `${t.head}:${t.banding}`,
      ]),
    );
    for (const head of ["circle", "squircle", "capsule", "egg"]) {
      expect(pairs.has(`${head}:wings`)).toBe(true);
      expect(pairs.has(`${head}:bug-eyes`)).toBe(true);
      expect(pairs.has(`${head}:bands`)).toBe(true);
    }
    expect(pairs.has("capsule:block")).toBe(true);
    expect(pairs.has("capsule:antenna")).toBe(true);
  });

  // TEST_SCENARIO: Colour variety comes from combining palettes. An avatar's parts draw on more than its head colour.
  it("combines several colours in one figure", () => {
    for (const { traits } of ALL.slice(0, 200)) {
      const colors = new Set(
        Object.values(traits.colors).filter((c): c is string => c !== null),
      );
      expect(colors.size).toBeGreaterThanOrEqual(3);
    }
  });

  // TEST_SCENARIO: Most figures carry sclera eyes, and every derpy variation shows up across a realistic spread of names.
  it("uses every eye variation", () => {
    const derps = new Set(ALL.map(({ traits }) => traits.derp).filter(Boolean));
    expect(derps).toEqual(new Set(DERPS));
  });
});

describe("face layout", () => {
  // TEST_SCENARIO: A gap cuts a figure into parts. An eye sitting across a gap reads as broken, so eyes are fitted between the gaps, and inside the head.
  it("never puts an eye on a gap or past the head", () => {
    for (const { name, traits } of ALL) {
      const head = HEAD_GEOMETRY[traits.head];
      for (const e of placeEyes(traits, head)) {
        expect(overlaps(e.y - e.r, e.y + e.r, traits), name).toBe(false);
        expect(Math.abs(e.x - 50) + e.r, name).toBeLessThanOrEqual(
          head.halfWidth,
        );
        expect(e.y - e.r, name).toBeGreaterThanOrEqual(head.top + 4);
        expect(e.y + e.r, name).toBeLessThanOrEqual(head.bottom - 4);
      }
    }
  });

  // TEST_SCENARIO: A visor carries its own gap ring. That ring must not run into the cap, chin or band gaps.
  it("keeps the visor and its ring clear of other gaps", () => {
    for (const { name, traits } of ALL) {
      if (traits.face !== "visor" && traits.face !== "happy") continue;
      const box = visorBox(traits, HEAD_GEOMETRY[traits.head]);
      expect(box.height, name).toBeGreaterThan(8);
      expect(
        overlaps(box.y - AVATAR_GAP, box.y + box.height + AVATAR_GAP, traits),
        name,
      ).toBe(false);
    }
  });

  // TEST_SCENARIO: Bug eyes float above the head. Even the big one must stay inside the drawing area.
  it("keeps bug eyes inside the avatar", () => {
    for (const { traits } of ALL) {
      if (traits.top !== "bug-eyes") continue;
      traits.bugEyes.forEach((bug, i) => {
        const [, cy] = bugEyeCenter(HEAD_GEOMETRY[traits.head], i, bug.r);
        expect(cy - bug.r).toBeGreaterThanOrEqual(-3);
      });
    }
  });
});
