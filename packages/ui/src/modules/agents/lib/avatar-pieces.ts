import { CHAR_COLORS, type CharName, cpth } from "../components/char-avatar.js";

export type PieceKey =
  | "teardrop"
  | "dWing"
  | "halfDisc"
  | "crescent"
  | "bar"
  | "shortBar"
  | "eye";

export const AVATAR_PIECES: Record<PieceKey, { d: string; viewBox: string }> = {
  teardrop: {
    d: "M88.32 85.79L108.71 67.84L108.72 95.73C108.63 100.73 106.21 106.37 99.75 108.40C93.04 110.52 85.81 106.77 83.69 100.05C81.90 94.36 84.20 89.45 88.32 85.79Z",
    viewBox: "81.5 67.5 27.5 43.5",
  },
  dWing: {
    d: "M966 2551C661.827 2408.46 450 2099.72 450 1742.07C450 1384.17 661.492 1077.41 966 935L966 2551Z",
    viewBox: "450 935 516 1616",
  },
  halfDisc: {
    d: "M933 1901C1075.54 2205.17 1384.28 2417 1741.93 2417C2099.83 2417 2406.59 2205.51 2549 1901H933Z",
    viewBox: "933 1901 1616 516",
  },
  crescent: {
    d: "M1743 552C1279.54 552 875.172 799.73 655 1178.76V1389.86C917.95 1088.18 1307.39 895.43 1743 895.43C2178.61 895.43 2568.05 1088.18 2831 1389.86V1178.76C2610.83 799.73 2206.46 552 1743 552Z",
    viewBox: "655 552 2176 838",
  },
  bar: { d: "M0 0H1616V489H0Z", viewBox: "0 0 1616 489" },
  shortBar: { d: "M0 0H1126V489H0Z", viewBox: "0 0 1126 489" },
  eye: { d: cpth(250, 250, 250), viewBox: "0 0 500 500" },
};

export interface ConfettiPiece {
  piece: PieceKey;
  color: string;
  size: number;
}

const c = CHAR_COLORS;

export const CONFETTI_THEMES: Record<CharName, ConfettiPiece[]> = {
  stack: [
    { piece: "bar", color: c.stack.body, size: 20 },
    { piece: "eye", color: c.stack.eyes, size: 9 },
    { piece: "bar", color: c.stack.body, size: 16 },
  ],
  shield: [
    { piece: "dWing", color: c.shield.wings, size: 17 },
    { piece: "shortBar", color: c.shield.body, size: 16 },
    { piece: "eye", color: c.shield.eyes, size: 9 },
  ],
  roller: [
    { piece: "halfDisc", color: c.roller.wings, size: 20 },
    { piece: "shortBar", color: c.roller.body, size: 16 },
    { piece: "eye", color: "#000000", size: 8 },
    { piece: "eye", color: c.roller.eyes, size: 9 },
  ],
  tower: [
    { piece: "bar", color: c.tower.body, size: 20 },
    { piece: "eye", color: c.tower.eyes, size: 9 },
  ],
  wave: [
    { piece: "crescent", color: c.wave.body, size: 22 },
    { piece: "eye", color: c.wave.eyes, size: 9 },
    { piece: "crescent", color: c.wave.body, size: 17 },
  ],
  compass: [
    { piece: "teardrop", color: c.compass.wings, size: 17 },
    { piece: "eye", color: c.compass.eyes, size: 9 },
    { piece: "teardrop", color: c.compass.wings, size: 13 },
  ],
  spark: [
    { piece: "dWing", color: c.spark.wings, size: 17 },
    { piece: "eye", color: c.spark.body, size: 13 },
    { piece: "eye", color: c.spark.eyes, size: 9 },
  ],
  lens: [
    { piece: "eye", color: c.lens.eyes, size: 13 },
    { piece: "eye", color: c.lens.eyes, size: 8 },
    { piece: "eye", color: c.lens.eyes, size: 11 },
  ],
};

export function pieceBox(piece: PieceKey, size: number) {
  const [, , w, h] = AVATAR_PIECES[piece].viewBox.split(" ").map(Number) as [
    number,
    number,
    number,
    number,
  ];
  const s = size / Math.max(w, h);
  return { width: w * s, height: h * s };
}
