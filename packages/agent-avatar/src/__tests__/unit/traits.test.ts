// TEST_OVERVIEW: An agent avatar is a figure drawn from a hash of the agent's name and its owner, so nothing is stored. The same name must always draw the same figure; its parts mix freely across head shapes; and no eye or visor may sit on a gap between parts, or reach past the head.
import { describe, expect, it } from "vitest";

import { clearance, HEAD_GEOMETRY, samplePath } from "../../geometry.js";
import {
  bugEyeCenter,
  EDGE_MARGIN,
  gapRanges,
  hatLayout,
  IMAGE_TOP,
  MOUTH_Y,
  mouthFits,
  placeEyes,
  STRAP_WIDTH,
  strapLine,
  visorBox,
  wingPath,
  winkLayout,
} from "../../layout.js";
import {
  AVATAR_GAP,
  AVATAR_PALETTES,
  avatarKey,
  avatarSeed,
  type AvatarTraits,
  avatarTraits,
  DERPS,
  HEAD_SHAPES,
  hueDistance,
} from "../../traits.js";

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

  // TEST_SCENARIO: Two people who both keep a default-named agent must not get the same face, so the owner is part of the seed.
  it("draws different figures for the same name under different owners", () => {
    const faces = new Set(
      ["owner-a", "owner-b", "owner-c", "owner-d"].map((owner) =>
        JSON.stringify(avatarTraits(avatarKey(owner, "my-agent"))),
      ),
    );
    expect(faces.size).toBe(4);
    expect(avatarTraits(avatarKey("owner-a", "my-agent"))).toEqual(
      avatarTraits(avatarKey("owner-a", "my-agent")),
    );
  });

  // TEST_SCENARIO: The server renders a Slack icon from the name's hash, so the URL never carries the name. The hash must draw the same figure as the name.
  it("draws the same figure from the name's hash", () => {
    for (const name of NAMES.slice(0, 100))
      expect(avatarTraits(avatarSeed(name)), name).toEqual(avatarTraits(name));
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
    expect(pairs.has("capsule:hat")).toBe(true);
  });

  // TEST_SCENARIO: Every variation of every part turns up across a realistic spread of names, so none is dead weight in the tables.
  it("uses every variation of every part", () => {
    const seen = (pick: (t: AvatarTraits) => string) =>
      new Set(ALL.map(({ traits }) => pick(traits)));
    expect(seen((t) => t.head)).toEqual(new Set(HEAD_SHAPES));
    expect(seen((t) => t.face)).toEqual(
      new Set(["eyes", "visor", "happy", "wink", "shades", "dots", "blank"]),
    );
    expect(seen((t) => t.sides)).toEqual(
      new Set(["none", "block", "round", "wings", "fins", "double"]),
    );
    expect(seen((t) => t.top)).toEqual(
      new Set(["none", "hat", "bolt", "cap", "bug-eyes", "crown", "siren"]),
    );
    expect(seen((t) => t.banding)).toEqual(
      new Set(["none", "chin", "bands", "belt"]),
    );
    expect(seen((t) => t.bottom)).toEqual(
      new Set(["none", "neck", "stripes", "stand", "wheels"]),
    );
    expect(seen((t) => t.mouth)).toEqual(
      new Set(["none", "line", "smile", "o", "grin", "cat"]),
    );
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

  // TEST_SCENARIO: Colours come from a fixed grid of hues and tones. Two parts never differ by a shade too small to read as deliberate, so every colour is a grid entry and each part's hue sits well away from the head's.
  it("draws every colour from the quantized palette", () => {
    const hueOf = new Map(
      AVATAR_PALETTES.flatMap((p) =>
        [p.base, p.shade, p.light].map((c) => [c, p.hue] as const),
      ),
    );
    expect(hueOf.size).toBe(AVATAR_PALETTES.length * 3);
    for (const { name, traits } of ALL) {
      for (const color of Object.values(traits.colors))
        if (color !== null) expect(hueOf.has(color), name).toBe(true);
      const head = hueOf.get(traits.colors.head)!;
      for (const part of ["side", "ornament", "cap", "band"] as const)
        expect(
          hueDistance(head, hueOf.get(traits.colors[part])!),
          name,
        ).toBeGreaterThanOrEqual(2);
    }
  });

  // TEST_SCENARIO: Most figures carry sclera eyes, and every derpy variation shows up across a realistic spread of names.
  it("uses every eye variation", () => {
    const derps = new Set(ALL.map(({ traits }) => traits.derp).filter(Boolean));
    expect(derps).toEqual(new Set(DERPS));
  });
});

describe("face layout", () => {
  // TEST_SCENARIO: A gap cuts a figure into parts. An eye sitting across a gap, or pressed against the head's outline, reads as broken, so eyes keep clear of both.
  it("keeps every eye clear of gaps and of the head's outline", () => {
    for (const { name, traits } of ALL) {
      const head = HEAD_GEOMETRY[traits.head];
      for (const e of placeEyes(traits, head)) {
        expect(overlaps(e.y - e.r - 2, e.y + e.r + 2, traits), name).toBe(
          false,
        );
        expect(clearance(head, e.x, e.y) - e.r, name).toBeGreaterThanOrEqual(
          EDGE_MARGIN - 0.01,
        );
      }
    }
  });

  // TEST_SCENARIO: Eyes may sit close for a derpy look, but two eyes that touch read as one blob.
  it("keeps eyes apart from each other", () => {
    for (const { name, traits } of ALL) {
      const eyes = placeEyes(traits, HEAD_GEOMETRY[traits.head]);
      for (let i = 0; i < eyes.length; i++)
        for (let j = i + 1; j < eyes.length; j++) {
          const a = eyes[i]!;
          const b = eyes[j]!;
          const gap = Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r;
          expect(gap, name).toBeGreaterThanOrEqual(2.5);
        }
    }
  });

  // TEST_SCENARIO: A mouth under the eyes needs a clear line between them, and must sit inside the head.
  it("keeps the mouth clear of the eyes and the outline", () => {
    for (const { name, traits } of ALL) {
      if (traits.mouth === "none") continue;
      const head = HEAD_GEOMETRY[traits.head];
      expect(mouthFits(head), name).toBe(true);
      for (const e of placeEyes(traits, head))
        expect(MOUTH_Y - 2.5 - (e.y + e.r), name).toBeGreaterThanOrEqual(4);
    }
  });

  // TEST_SCENARIO: On a narrow head the wink's dot and dash must still keep a margin from the outline.
  it("fits the wink inside the head", () => {
    for (const { name, traits } of ALL) {
      if (traits.face !== "wink" && traits.face !== "dots") continue;
      const head = HEAD_GEOMETRY[traits.head];
      const { dot, dash } = winkLayout(traits, head);
      expect(
        overlaps(dot.cy - dot.r - 2, dot.cy + dot.r + 2, traits),
        name,
      ).toBe(false);
      expect(
        clearance(head, dot.cx, dot.cy) - dot.r,
        name,
      ).toBeGreaterThanOrEqual(EDGE_MARGIN - 0.01);
      expect(
        clearance(head, dash.x + dash.width - dash.rx, dash.y + dash.rx) -
          dash.rx,
        name,
      ).toBeGreaterThanOrEqual(EDGE_MARGIN - 0.01);
    }
  });

  // TEST_SCENARIO: A visor carries its own gap ring. That ring must not run into the cap, chin or band gaps, nor into the head's outline.
  it("keeps the visor and its ring clear of other gaps and the outline", () => {
    for (const { name, traits } of ALL) {
      if (!["visor", "happy", "shades"].includes(traits.face)) continue;
      const head = HEAD_GEOMETRY[traits.head];
      const box = visorBox(traits, head);
      expect(box.height, name).toBeGreaterThan(8);
      expect(
        overlaps(box.y - AVATAR_GAP, box.y + box.height + AVATAR_GAP, traits),
        name,
      ).toBe(false);
      const corner = clearance(head, box.x + box.rx, box.y + box.rx);
      expect(corner - box.rx - AVATAR_GAP, name).toBeGreaterThanOrEqual(1.9);
    }
  });

  // TEST_SCENARIO: Bug eyes float above the head. They stay inside the drawing area and apart from each other.
  it("keeps bug eyes inside the avatar and apart", () => {
    for (const { traits } of ALL) {
      if (traits.top !== "bug-eyes") continue;
      const head = HEAD_GEOMETRY[traits.head];
      const [a, b] = traits.bugEyes.map((bug, i) => ({
        r: bug.r,
        c: bugEyeCenter(head, i, bug.r),
      }));
      for (const eye of [a!, b!])
        expect(eye.c[1] - eye.r).toBeGreaterThanOrEqual(-4);
      expect(a!.c[0] + a!.r + 4).toBeLessThanOrEqual(b!.c[0] - b!.r);
    }
  });

  // TEST_SCENARIO: Wings attach with a vertical inner edge a clear gap from the body, and stay inside the drawing area.
  it("attaches wings with a vertical inner edge clear of the head", () => {
    for (const shape of HEAD_SHAPES) {
      const head = HEAD_GEOMETRY[shape];
      for (const side of [-1, 1] as const) {
        const d = wingPath(head, side);
        const [x1, y1, x2, y2] = d
          .match(/-?\d*\.?\d+/g)!
          .slice(0, 4)
          .map(Number) as [number, number, number, number];
        expect(Math.abs(x1 - x2), shape).toBeLessThan(0.01);
        expect(y2).toBeGreaterThan(y1);
        for (let y = y1; y <= y2; y += 1)
          expect(clearance(head, x1, y), shape).toBeLessThanOrEqual(-4);
        const xs = d.match(/-?\d*\.?\d+/g)!.map(Number);
        expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
        expect(Math.max(...xs)).toBeLessThanOrEqual(100);
      }
    }
  });

  // TEST_SCENARIO: The image is a fixed 100-unit square starting 4 units above zero. Stacked parts below the head, and the hat or bug eyes above it, must not be cut off at its edges, and the hat keeps a gap between brim, crown and head.
  it("keeps parts above and below every head inside the image", () => {
    for (const shape of HEAD_SHAPES) {
      const head = HEAD_GEOMETRY[shape];
      const stripesBottom = head.bottom + AVATAR_GAP * 2 + 5.5 * 2;
      expect(stripesBottom, shape).toBeLessThanOrEqual(96);
      const standBottom = head.bottom + AVATAR_GAP * 2 + 5.5 * 2;
      expect(standBottom, shape).toBeLessThanOrEqual(96);
      expect(head.bottom + AVATAR_GAP + 10, shape).toBeLessThanOrEqual(96);
      expect(head.top - AVATAR_GAP - 12, shape).toBeGreaterThanOrEqual(-4);
      const { brim, crown } = hatLayout(head);
      expect(crown.y, shape).toBeGreaterThanOrEqual(IMAGE_TOP);
      expect(crown.height, shape).toBeGreaterThanOrEqual(10);
      expect(brim.y - crown.y - crown.height, shape).toBeCloseTo(AVATAR_GAP);
      expect(head.top - brim.y - brim.height, shape).toBeCloseTo(AVATAR_GAP);
      expect(head.top - AVATAR_GAP - 1 - 8.5 * 2, shape).toBeGreaterThanOrEqual(
        -4,
      );
    }
  });
});

describe("head outline sampling", () => {
  // TEST_SCENARIO: A head drawn with a second subpath after closing the first must keep every segment, or the outline that every eye and visor is fitted against comes out short.
  it("keeps the commands that follow a close", () => {
    const points = samplePath("M0,0 L10,0 L10,10 Z M20,20 L30,20");
    expect(points).toContainEqual([20, 20]);
    expect(points).toContainEqual([30, 20]);
  });

  // TEST_SCENARIO: A head drawn with a command the sampler cannot trace, such as an arc, must fail loudly rather than yield an outline that places features outside the head.
  it("refuses a command it cannot trace, even right after a close", () => {
    expect(() => samplePath("M0,0 L10,0 Z A5,5 0 0 1 20,20")).toThrow(/A/);
    expect(() => samplePath("M0,0 L10,0 Z 5,5")).toThrow();
  });

  // TEST_SCENARIO: Now and then a two-eyed figure wears a pirate eyepatch over one eye. Its strap runs across the head clear of the uncovered eye, so the patch never hides the face it sits on.
  it("puts an occasional eyepatch on a two-eyed face, its strap clear of the other eye", () => {
    const patched = ALL.filter(({ traits }) => traits.patch !== null);
    expect(patched.length).toBeGreaterThan(20);
    expect(patched.length).toBeLessThan(ALL.length / 5);
    for (const { name, traits } of patched) {
      expect(traits.face, name).toBe("eyes");
      expect(traits.eyes, name).toHaveLength(2);
      const head = HEAD_GEOMETRY[traits.head];
      const strap = strapLine(traits, head, traits.patch!)!;
      expect(strap, name).not.toBeNull();
      const other = placeEyes(traits, head)[1 - traits.patch!]!;
      const dx = strap.x2 - strap.x1;
      const dy = strap.y2 - strap.y1;
      const distance =
        Math.abs(dy * (other.x - strap.x1) - dx * (other.y - strap.y1)) /
        Math.hypot(dx, dy);
      expect(distance, name).toBeGreaterThanOrEqual(
        other.r + STRAP_WIDTH / 2 + AVATAR_GAP,
      );
    }
  });
});
