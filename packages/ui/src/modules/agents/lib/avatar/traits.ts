export const AVATAR_INK = "#1b2a4a";
export const AVATAR_SCLERA = "#fffdf8";
export const AVATAR_GAP = 3.2;

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
];

export const AVATAR_ACCENTS: readonly string[] = [
  "#f5a05a",
  "#5ecdb0",
  "#c3a4e6",
  "#f08a8e",
  "#fccf73",
];

export const HEAD_SHAPES = [
  "circle",
  "squircle",
  "octagon",
  "egg",
  "box",
  "bell",
] as const;
export type HeadShape = (typeof HEAD_SHAPES)[number];

export type Face = "eyes" | "visor" | "happy" | "wink" | "stripes";

export const EARS = ["none", "block", "round"] as const;
export type Ears = (typeof EARS)[number];

export const TOPS = ["none", "antenna", "twin", "cap", "bolt"] as const;
export type Top = (typeof TOPS)[number] | "stalks";

export const BOTTOMS = ["neck", "stripes", "chin"] as const;
export type Bottom = (typeof BOTTOMS)[number];

export const MOUTHS = ["none", "line", "grille"] as const;
export type Mouth = (typeof MOUTHS)[number];

export interface EyeSpec {
  x: number;
  y: number;
  r: number;
  pupil: number;
  look: { dx: number; dy: number };
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

export interface AvatarTraits {
  palette: AvatarPalette;
  capColor: string;
  accent: string;
  head: HeadShape;
  face: Face;
  derp: Derp | null;
  eyes: EyeSpec[];
  stalkLooks: [EyeSpec["look"], EyeSpec["look"]];
  ears: Ears;
  top: Top;
  bottom: Bottom;
  mouth: Mouth;
}

type Random = () => number;

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

function between(random: Random, min: number, max: number): number {
  return min + random() * (max - min);
}

function randomLook(random: Random): EyeSpec["look"] {
  const angle = random() * Math.PI * 2;
  return { dx: Math.cos(angle), dy: Math.sin(angle) };
}

function sideLook(random: Random, side: 1 | -1): EyeSpec["look"] {
  const angle = between(random, -0.35, 0.35);
  return { dx: side * Math.cos(angle), dy: Math.sin(angle) };
}

function eye(
  x: number,
  y: number,
  r: number,
  look: EyeSpec["look"],
  pupil = 0.46,
): EyeSpec {
  return { x, y, r, pupil, look };
}

const FACE_WEIGHTS: readonly (readonly [Face, number])[] = [
  ["eyes", 66],
  ["visor", 10],
  ["happy", 8],
  ["wink", 6],
  ["stripes", 10],
];

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

export function avatarTraits(seed: string): AvatarTraits {
  const random = mulberry32(hashSeed(seed));
  const palette = pickFrom(random, AVATAR_PALETTES);
  const others = AVATAR_PALETTES.filter((p) => p !== palette);
  const capColor = pickFrom(random, others).base;
  const accent = pickFrom(random, AVATAR_ACCENTS);
  const head = pickFrom(random, HEAD_SHAPES);
  const face = pickWeighted(random, FACE_WEIGHTS);
  const derp = face === "eyes" ? pickFrom(random, DERPS) : null;
  const eyes = derp ? derpEyes(derp, random) : [];
  const stalkLooks: AvatarTraits["stalkLooks"] = [
    randomLook(random),
    randomLook(random),
  ];
  const ears = pickFrom(random, EARS);
  const pickedTop = pickFrom(random, TOPS);
  const top: Top = face === "stripes" ? "stalks" : pickedTop;
  const bottom = pickFrom(random, BOTTOMS);
  const pickedMouth = pickFrom(random, MOUTHS);
  const lowestEye = Math.max(0, ...eyes.map((e) => e.y + e.r));
  const mouth: Mouth =
    face === "eyes" && bottom !== "chin" && lowestEye < 62
      ? pickedMouth
      : "none";
  return {
    palette,
    capColor,
    accent,
    head,
    face,
    derp,
    eyes,
    stalkLooks,
    ears,
    top,
    bottom,
    mouth,
  };
}
