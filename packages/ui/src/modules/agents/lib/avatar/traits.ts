import { HEAD_GEOMETRY } from "./geometry.js";
import {
  faceZone,
  mouthFits,
  placeEyes,
  visorBox,
  WINK_HEIGHT,
} from "./layout.js";

export { AVATAR_GAP, AVATAR_INK, AVATAR_SCLERA } from "./constants.js";

export interface AvatarPalette {
  hue: number;
  base: string;
  shade: string;
  light: string;
}

export const AVATAR_HUE_STEPS = 12;
const MIN_HUE_DISTANCE = 2;

const HUE_OFFSET = 5;
const YELLOW_HUE = 95;
const YELLOW_LIFT = 0.1;

const TONES = {
  base: { l: 0.74, c: 0.16 },
  shade: { l: 0.61, c: 0.18 },
  light: { l: 0.88, c: 0.09 },
} as const;

function oklchToLinearRgb(l: number, c: number, hue: number) {
  const a = c * Math.cos((hue * Math.PI) / 180);
  const b = c * Math.sin((hue * Math.PI) / 180);
  const lc = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mc = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sc = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc,
    -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc,
    -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc,
  ];
}

function oklch(l: number, c: number, hue: number): string {
  let chroma = c;
  while (oklchToLinearRgb(l, chroma, hue).some((v) => v < 0 || v > 1))
    chroma -= 0.002;
  const channels = oklchToLinearRgb(l, chroma, hue).map((v) => {
    const encoded = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
    return Math.round(encoded * 255)
      .toString(16)
      .padStart(2, "0");
  });
  return `#${channels.join("")}`;
}

function tone(hue: number, { l, c }: { l: number; c: number }): string {
  const lift = YELLOW_LIFT * Math.exp(-(((hue - YELLOW_HUE) / 35) ** 2));
  return oklch(Math.min(l + lift, 0.93), c, hue);
}

export const AVATAR_PALETTES: readonly AvatarPalette[] = Array.from(
  { length: AVATAR_HUE_STEPS },
  (_, hue) => {
    const degrees = HUE_OFFSET + hue * (360 / AVATAR_HUE_STEPS);
    return {
      hue,
      base: tone(degrees, TONES.base),
      shade: tone(degrees, TONES.shade),
      light: tone(degrees, TONES.light),
    };
  },
);

export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % AVATAR_HUE_STEPS;
  return Math.min(d, AVATAR_HUE_STEPS - d);
}

export const HEAD_SHAPES = [
  "circle",
  "squircle",
  "octagon",
  "egg",
  "box",
  "bell",
  "capsule",
  "hexagon",
  "shield",
] as const;
export type HeadShape = (typeof HEAD_SHAPES)[number];

export type Face =
  | "eyes"
  | "visor"
  | "happy"
  | "wink"
  | "shades"
  | "dots"
  | "blank";
export type Sides = "none" | "block" | "round" | "wings" | "fins" | "double";
export type Top =
  | "none"
  | "hat"
  | "bolt"
  | "cap"
  | "bug-eyes"
  | "crown"
  | "siren";
export type Banding = "none" | "chin" | "bands" | "belt";
export type Bottom = "none" | "neck" | "stripes" | "stand" | "wheels";
export type Mouth = "none" | "line" | "smile" | "o" | "grin" | "cat";

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
  "tiny",
  "quad",
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

export function avatarKey(owner: string, name: string): string {
  return `${owner}\n${name}`;
}

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
      return [eye(-12.5, 48, 9.5, look), eye(12.5, 48, 9.5, look)];
    }
    case "wonky":
      return [
        eye(-12.5, 48, 9.5, randomLook(random)),
        eye(12.5, 48, 9.5, randomLook(random)),
      ];
    case "mismatched": {
      const big = between(random, 11, 12);
      const small = between(random, 6.5, 7.5);
      return side < 0
        ? [
            eye(-10, 48, big, randomLook(random)),
            eye(13.5, 49, small, randomLook(random)),
          ]
        : [
            eye(-13.5, 49, small, randomLook(random)),
            eye(10, 48, big, randomLook(random)),
          ];
    }
    case "uneven": {
      const lift = between(random, 4, 7) * side;
      const look = randomLook(random);
      return [eye(-12.5, 48 - lift, 9, look), eye(12.5, 48 + lift, 9, look)];
    }
    case "googly":
      return [
        eye(-12.5, 47, 10.5, randomLook(random), 0.38),
        eye(12.5, 47, 10.5, randomLook(random), 0.38),
      ];
    case "cyclops":
      return [eye(0, 47, 13, randomLook(random), 0.5)];
    case "huge-cyclops":
      return [eye(0, 49, 17, sideLook(random, side), 0.44)];
    case "triple":
      return [
        eye(-12, 42, 6.5, randomLook(random)),
        eye(12, 42, 6.5, randomLook(random)),
        eye(0, 57, 8, randomLook(random)),
      ];
    case "tiny": {
      const look = random() < 0.5 ? sideLook(random, side) : randomLook(random);
      return [eye(-17, 48, 5.5, look, 0), eye(17, 48, 5.5, look, 0)];
    }
    case "quad":
      return [
        eye(-10, 41, 6, randomLook(random)),
        eye(10, 41, 6, randomLook(random)),
        eye(-10, 57, 6, randomLook(random)),
        eye(10, 57, 6, randomLook(random)),
      ];
    case "trio-row": {
      const look = random() < 0.5 ? sideLook(random, side) : null;
      return [-17, 0, 17].map((x, i) =>
        eye(
          x,
          49 + (i === 1 ? -3 : 0),
          i === 1 ? 7.5 : 5.5,
          look ?? randomLook(random),
        ),
      );
    }
  }
}

const TOP_WEIGHTS: readonly (readonly [Top, number])[] = [
  ["none", 14],
  ["hat", 17],
  ["bolt", 11],
  ["cap", 15],
  ["bug-eyes", 18],
  ["crown", 13],
  ["siren", 12],
];

const FACE_WEIGHTS: readonly (readonly [Face, number])[] = [
  ["eyes", 60],
  ["visor", 10],
  ["happy", 8],
  ["wink", 8],
  ["shades", 7],
  ["dots", 7],
];

const BUG_FACE_WEIGHTS: readonly (readonly [Face, number])[] = [
  ["blank", 38],
  ["eyes", 20],
  ["happy", 12],
  ["wink", 12],
  ["dots", 18],
];

const BANDING_WEIGHTS: readonly (readonly [Banding, number])[] = [
  ["none", 45],
  ["chin", 20],
  ["bands", 20],
  ["belt", 15],
];

const SIDES_ANY: readonly Sides[] = [
  "none",
  "block",
  "round",
  "wings",
  "fins",
  "double",
];
const SIDES_WIDE: readonly Sides[] = [
  "none",
  "block",
  "round",
  "fins",
  "double",
];
const BOTTOMS: readonly Bottom[] = [
  "none",
  "neck",
  "neck",
  "stripes",
  "stand",
  "wheels",
];
const MOUTHS: readonly Mouth[] = ["none", "line", "smile", "o", "grin", "cat"];

function pickPalettes(
  random: Random,
): [AvatarPalette, AvatarPalette, AvatarPalette] {
  let pool = [...AVATAR_PALETTES];
  const take = () => {
    const picked = pickFrom(random, pool);
    pool = pool.filter(
      (p) => hueDistance(p.hue, picked.hue) >= MIN_HUE_DISTANCE,
    );
    return picked;
  };
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
    band: either(secondary.base, tertiary.base),
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
    { r: bugRadius(bugBigLeft) },
    { r: bugRadius(!bugBigLeft) },
  ];
  const sides = pickFrom(random, head === "box" ? SIDES_WIDE : SIDES_ANY);
  const banding = pickWeighted(random, BANDING_WEIGHTS);
  const bottom = pickFrom(random, BOTTOMS);
  const pickedMouth = pickFrom(random, MOUTHS);
  const hasMouth =
    (face === "eyes" || face === "blank" || face === "dots") &&
    banding === "none" &&
    mouthFits(HEAD_GEOMETRY[head]);
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
    mouth: hasMouth ? pickedMouth : "none",
  });
}

const MIN_VISOR_HEIGHT = 14;
const MIN_EYE_SCALE = 0.65;

function faceFits(traits: AvatarTraits): boolean {
  const head = HEAD_GEOMETRY[traits.head];
  if (
    traits.face === "visor" ||
    traits.face === "happy" ||
    traits.face === "shades"
  )
    return visorBox(traits, head).height >= MIN_VISOR_HEIGHT;
  if (traits.face === "wink" || traits.face === "dots") {
    const zone = faceZone(traits, head);
    return zone.bottom - zone.top >= WINK_HEIGHT;
  }
  const placed = placeEyes(traits, head);
  return placed.every((e, i) => e.r >= traits.eyes[i]!.r * MIN_EYE_SCALE);
}

function makeRoomForFace(traits: AvatarTraits): AvatarTraits {
  if (faceFits(traits)) return traits;
  const unbanded: AvatarTraits = { ...traits, banding: "none" };
  if (faceFits(unbanded)) return unbanded;
  return { ...unbanded, top: "none" };
}
