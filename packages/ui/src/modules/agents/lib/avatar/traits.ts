import { HEAD_GEOMETRY } from "./geometry.js";
import { placeEyes, visorBox } from "./layout.js";

export { AVATAR_GAP, AVATAR_INK, AVATAR_SCLERA } from "./constants.js";

export interface AvatarPalette {
  base: string;
  shade: string;
  light: string;
}

export const AVATAR_PALETTES: readonly AvatarPalette[] = [
  { base: "#8fc1f4", shade: "#4c8fe6", light: "#c4defa" },
  { base: "#72c07c", shade: "#4e9e5b", light: "#abdcb2" },
  { base: "#f08a8e", shade: "#e26a8a", light: "#f8bec0" },
  { base: "#f3837c", shade: "#d9605b", light: "#f9b9b4" },
  { base: "#fccf73", shade: "#f5a05a", light: "#fde6b4" },
  { base: "#c3a4e6", shade: "#8e67c4", light: "#e2d2f4" },
  { base: "#f8ae5e", shade: "#ee8a45", light: "#fcd5a8" },
  { base: "#5ecdb0", shade: "#35a88b", light: "#a7e6d5" },
  { base: "#df9fe5", shade: "#c075cf", light: "#f0cdf3" },
  { base: "#7d9de6", shade: "#4f7fe0", light: "#b9cbf3" },
  { base: "#b5d86a", shade: "#86b43f", light: "#d9ecb2" },
  { base: "#f4a3c4", shade: "#e27aa7", light: "#fad1e2" },
  { base: "#6fc9e6", shade: "#3aa6c9", light: "#b3e4f3" },
  { base: "#e9b98c", shade: "#cf8f58", light: "#f5dcc4" },
];

export const HEAD_SHAPES = [
  "circle",
  "squircle",
  "octagon",
  "egg",
  "box",
  "bell",
  "capsule",
] as const;
export type HeadShape = (typeof HEAD_SHAPES)[number];

export type Face = "eyes" | "visor" | "happy" | "wink" | "blank";
export type Sides = "none" | "block" | "round" | "wings";
export type Top = "none" | "antenna" | "twin" | "bolt" | "cap" | "bug-eyes";
export type Banding = "none" | "chin" | "bands";
export type Bottom = "none" | "neck" | "stripes";
export type Mouth = "none" | "line" | "smile" | "o";

export interface Look {
  dx: number;
  dy: number;
}

export interface EyeSpec {
  x: number;
  y: number;
  r: number;
  pupil: number;
  look: Look;
}

export interface BugEye {
  r: number;
  look: Look;
}

export const DERPS = [
  "side-eye",
  "wonky",
  "mismatched",
  "uneven",
  "googly",
  "cyclops",
  "huge-cyclops",
  "triple",
  "trio-row",
] as const;
export type Derp = (typeof DERPS)[number];

export interface AvatarColors {
  head: string;
  headShade: string;
  side: string;
  ornament: string;
  cap: string;
  chin: string;
  band: string;
  bottom: string;
  neck: string | null;
  glow: string;
}

export interface AvatarTraits {
  colors: AvatarColors;
  head: HeadShape;
  face: Face;
  derp: Derp | null;
  eyes: EyeSpec[];
  bugEyes: [BugEye, BugEye];
  sides: Sides;
  top: Top;
  banding: Banding;
  bottom: Bottom;
  mouth: Mouth;
}

export type Random = () => number;

function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(state: number): Random {
  let a = state;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickFrom<T>(random: Random, options: readonly T[]): T {
  return options[Math.floor(random() * options.length)]!;
}

function pickWeighted<T>(
  random: Random,
  weighted: readonly (readonly [T, number])[],
): T {
  const total = weighted.reduce((sum, [, w]) => sum + w, 0);
  let roll = random() * total;
  for (const [value, weight] of weighted) {
    roll -= weight;
    if (roll < 0) return value;
  }
  return weighted[weighted.length - 1]![0];
}

function between(random: Random, min: number, max: number): number {
  return min + random() * (max - min);
}

function randomLook(random: Random): Look {
  const angle = random() * Math.PI * 2;
  return { dx: Math.cos(angle), dy: Math.sin(angle) };
}

function sideLook(random: Random, side: 1 | -1): Look {
  const angle = between(random, -0.35, 0.35);
  return { dx: side * Math.cos(angle), dy: Math.sin(angle) };
}

function eye(x: number, y: number, r: number, look: Look, pupil = 0.46) {
  return { x, y, r, pupil, look };
}

export function derpEyes(derp: Derp, random: Random): EyeSpec[] {
  const side: 1 | -1 = random() < 0.5 ? -1 : 1;
  switch (derp) {
    case "side-eye": {
      const look = sideLook(random, side);
      return [eye(-13, 48, 10, look), eye(13, 48, 10, look)];
    }
    case "wonky":
      return [
        eye(-13, 48, 10, randomLook(random)),
        eye(13, 48, 10, randomLook(random)),
      ];
    case "mismatched": {
      const big = between(random, 11.5, 13);
      const small = between(random, 6.5, 8);
      return [
        eye(-12, 48, side < 0 ? big : small, randomLook(random)),
        eye(14, 49, side < 0 ? small : big, randomLook(random)),
      ];
    }
    case "uneven": {
      const lift = between(random, 4, 7) * side;
      const look = randomLook(random);
      return [eye(-13, 48 - lift, 9.5, look), eye(13, 48 + lift, 9.5, look)];
    }
    case "googly":
      return [
        eye(-12.5, 47, 12, randomLook(random), 0.38),
        eye(12.5, 47, 12, randomLook(random), 0.38),
      ];
    case "cyclops":
      return [eye(0, 47, 14, randomLook(random), 0.5)];
    case "huge-cyclops":
      return [eye(0, 50, 18, sideLook(random, side), 0.44)];
    case "triple":
      return [
        eye(-14, 44, 7, randomLook(random)),
        eye(14, 44, 7, randomLook(random)),
        eye(0, 56, 9, randomLook(random)),
      ];
    case "trio-row": {
      const look = random() < 0.5 ? sideLook(random, side) : null;
      return [-16, 0, 16].map((x, i) =>
        eye(
          x,
          49 + (i === 1 ? -3 : 0),
          i === 1 ? 8.5 : 6.5,
          look ?? randomLook(random),
        ),
      );
    }
  }
}

const TOP_WEIGHTS: readonly (readonly [Top, number])[] = [
  ["none", 14],
  ["antenna", 18],
  ["twin", 18],
  ["bolt", 12],
  ["cap", 16],
  ["bug-eyes", 16],
];

const FACE_WEIGHTS: readonly (readonly [Face, number])[] = [
  ["eyes", 68],
  ["visor", 12],
  ["happy", 10],
  ["wink", 10],
];

const BUG_FACE_WEIGHTS: readonly (readonly [Face, number])[] = [
  ["blank", 45],
  ["eyes", 25],
  ["happy", 15],
  ["wink", 15],
];

const BANDING_WEIGHTS: readonly (readonly [Banding, number])[] = [
  ["none", 50],
  ["chin", 25],
  ["bands", 25],
];

const SIDES_ANY: readonly Sides[] = ["none", "block", "round", "wings"];
const SIDES_WIDE: readonly Sides[] = ["none", "block", "round"];
const BOTTOMS: readonly Bottom[] = ["none", "neck", "neck", "stripes"];
const MOUTHS: readonly Mouth[] = ["none", "line", "smile", "o"];

function pickPalettes(
  random: Random,
): [AvatarPalette, AvatarPalette, AvatarPalette] {
  const pool = [...AVATAR_PALETTES];
  const take = () => pool.splice(Math.floor(random() * pool.length), 1)[0]!;
  return [take(), take(), take()];
}

function pickColors(random: Random): AvatarColors {
  const [primary, secondary, tertiary] = pickPalettes(random);
  const either = (a: string, b: string) => (random() < 0.5 ? a : b);
  return {
    head: primary.base,
    headShade: primary.shade,
    side: either(secondary.base, secondary.shade),
    ornament: either(tertiary.base, tertiary.shade),
    cap: either(secondary.base, tertiary.base),
    chin: either(primary.shade, secondary.base),
    band: either(primary.base, secondary.base),
    bottom: either(secondary.shade, tertiary.base),
    neck: random() < 0.5 ? null : tertiary.shade,
    glow: either(primary.light, tertiary.light),
  };
}

export function avatarTraits(seed: string): AvatarTraits {
  const random = mulberry32(hashSeed(seed));
  const colors = pickColors(random);
  const head = pickFrom(random, HEAD_SHAPES);
  const top = pickWeighted(random, TOP_WEIGHTS);
  const face = pickWeighted(
    random,
    top === "bug-eyes" ? BUG_FACE_WEIGHTS : FACE_WEIGHTS,
  );
  const derp = face === "eyes" ? pickFrom(random, DERPS) : null;
  const eyes = derp ? derpEyes(derp, random) : [];
  const bugMismatch = random() < 0.35;
  const bugBigLeft = random() < 0.5;
  const bugRadius = (big: boolean) => (bugMismatch ? (big ? 8.5 : 5.5) : 7);
  const bugEyes: AvatarTraits["bugEyes"] = [
    { r: bugRadius(bugBigLeft), look: randomLook(random) },
    { r: bugRadius(!bugBigLeft), look: randomLook(random) },
  ];
  const sides = pickFrom(random, head === "box" ? SIDES_WIDE : SIDES_ANY);
  const banding = pickWeighted(random, BANDING_WEIGHTS);
  const bottom = pickFrom(random, BOTTOMS);
  const pickedMouth = pickFrom(random, MOUTHS);
  const mouthFits = (face === "eyes" || face === "blank") && banding === "none";
  return makeRoomForFace({
    colors,
    head,
    face,
    derp,
    eyes,
    bugEyes,
    sides,
    top,
    banding,
    bottom,
    mouth: mouthFits ? pickedMouth : "none",
  });
}

const MIN_VISOR_HEIGHT = 14;
const MIN_EYE_SCALE = 0.6;

function faceFits(traits: AvatarTraits): boolean {
  const head = HEAD_GEOMETRY[traits.head];
  if (traits.face === "visor" || traits.face === "happy")
    return visorBox(traits, head).height >= MIN_VISOR_HEIGHT;
  const placed = placeEyes(traits, head);
  return placed.every((e, i) => e.r >= traits.eyes[i]!.r * MIN_EYE_SCALE);
}

function makeRoomForFace(traits: AvatarTraits): AvatarTraits {
  if (faceFits(traits)) return traits;
  const unbanded: AvatarTraits = { ...traits, banding: "none" };
  if (faceFits(unbanded)) return unbanded;
  return { ...unbanded, top: "none" };
}
