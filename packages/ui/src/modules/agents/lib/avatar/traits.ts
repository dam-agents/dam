export const AVATAR_INK = "#13254b";
export const AVATAR_SCLERA = "#fffdf7";

export interface AvatarPalette {
  base: string;
  shade: string;
  light: string;
}

export const AVATAR_PALETTES: readonly AvatarPalette[] = [
  { base: "#7ab6f5", shade: "#2f7fe8", light: "#b4d7fb" },
  { base: "#5db86a", shade: "#3c944a", light: "#9ad7a3" },
  { base: "#ee7277", shade: "#e9557a", light: "#f6a9ac" },
  { base: "#f25c54", shade: "#c9423c", light: "#f79a94" },
  { base: "#fdc65a", shade: "#f7913a", light: "#fee3a8" },
  { base: "#b892e0", shade: "#7a4cb4", light: "#dcc6f2" },
  { base: "#f7a03c", shade: "#ee7a2c", light: "#fbcd92" },
  { base: "#3cc4a0", shade: "#1f9a7b", light: "#98e3cf" },
  { base: "#d98be0", shade: "#b35cc4", light: "#eec4f2" },
  { base: "#5b84de", shade: "#2e6be0", light: "#a8c0f0" },
];

export const AVATAR_ACCENTS: readonly string[] = [
  "#f7913a",
  "#3cc4a0",
  "#b892e0",
  "#ee7277",
  "#fdc65a",
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

export const FACES = [
  "eyes",
  "visor",
  "cyclops",
  "happy",
  "wink",
  "stripes",
] as const;
export type Face = (typeof FACES)[number];

export const EARS = ["none", "block", "round"] as const;
export type Ears = (typeof EARS)[number];

export const TOPS = ["none", "antenna", "twin", "cap", "bolt"] as const;
export type Top = (typeof TOPS)[number] | "stalks";

export const BOTTOMS = ["neck", "stripes", "chin"] as const;
export type Bottom = (typeof BOTTOMS)[number];

export const MOUTHS = ["none", "line", "grille"] as const;
export type Mouth = (typeof MOUTHS)[number];

export interface AvatarTraits {
  palette: AvatarPalette;
  capColor: string;
  accent: string;
  head: HeadShape;
  face: Face;
  ears: Ears;
  top: Top;
  bottom: Bottom;
  mouth: Mouth;
  gaze: { dx: number; dy: number };
  eyeSizes: { left: number; right: number };
}

function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(state: number): () => number {
  let a = state;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickFrom<T>(random: () => number, options: readonly T[]): T {
  return options[Math.floor(random() * options.length)]!;
}

const FACES_WITH_MOUTH: ReadonlySet<Face> = new Set(["eyes", "cyclops"]);

export function avatarTraits(seed: string): AvatarTraits {
  const random = mulberry32(hashSeed(seed));
  const palette = pickFrom(random, AVATAR_PALETTES);
  const others = AVATAR_PALETTES.filter((p) => p !== palette);
  const capColor = pickFrom(random, others).base;
  const accent = pickFrom(random, AVATAR_ACCENTS);
  const head = pickFrom(random, HEAD_SHAPES);
  const face = pickFrom(random, FACES);
  const ears = pickFrom(random, EARS);
  const pickedTop = pickFrom(random, TOPS);
  const top: Top = face === "stripes" ? "stalks" : pickedTop;
  const bottom = pickFrom(random, BOTTOMS);
  const pickedMouth = pickFrom(random, MOUTHS);
  const mouth: Mouth =
    FACES_WITH_MOUTH.has(face) && bottom !== "chin" ? pickedMouth : "none";
  const gaze = {
    dx: Math.round((random() * 2 - 1) * 3),
    dy: Math.round((random() * 2 - 1) * 2),
  };
  const lopsided = random() < 0.35;
  const smallerLeft = random() < 0.5;
  const eyeSizes = lopsided
    ? { left: smallerLeft ? 0.75 : 1, right: smallerLeft ? 1 : 0.75 }
    : { left: 1, right: 1 };
  return {
    palette,
    capColor,
    accent,
    head,
    face,
    ears,
    top,
    bottom,
    mouth,
    gaze,
    eyeSizes,
  };
}
