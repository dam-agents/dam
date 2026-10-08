export const AVATAR_CHARACTERS = [
  "stack",
  "shield",
  "roller",
  "tower",
  "wave",
  "compass",
  "spark",
  "lens",
] as const;

export type AvatarCharacter = (typeof AVATAR_CHARACTERS)[number];

export type AvatarMood = "working" | "idle" | "asleep";

export const ASLEEP_FILL = "#a2a9b0";

const PINK = "#E89DA8";
const BLUE = "#5B76D2";
const ORANGE = "#DE9950";
const RUST = "#CA6040";
const GREEN = "#3F6C45";
const INK = "currentColor";

interface Palette {
  eyes: string;
  body: string;
  wings: string;
  ink: string;
}

type Eye = readonly [cx: number, cy: number, r: number];

interface Character {
  size: number;
  stroke: number;
  eyes: readonly Eye[];
  colors: Palette;
  figure: (c: Palette) => string;
}

const EYE_R = 249.42;
const pair = (cy: number): Eye[] => [
  [2094.25, cy, EYE_R],
  [1391.43, cy, EYE_R],
];

const rect = (x: number, y: number, w: number, h: number, fill: string) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
const path = (d: string, fill: string) => `<path d="${d}" fill="${fill}"/>`;

function circlePath(cx: number, cy: number, r: number): string {
  const k = r * 0.552;
  return `M${cx} ${cy - r}C${cx - k} ${cy - r} ${cx - r} ${cy - k} ${cx - r} ${cy}C${cx - r} ${cy + k} ${cx - k} ${cy + r} ${cx} ${cy + r}C${cx + k} ${cy + r} ${cx + r} ${cy + k} ${cx + r} ${cy}C${cx + r} ${cy - k} ${cx + k} ${cy - r} ${cx} ${cy - r}Z`;
}

function halfDisc(x: number, cy: number, r: number, side: -1 | 1): string {
  const k = r * 0.552 * side;
  const s = r * side;
  return `M${x} ${cy - r}C${x + k} ${cy - r} ${x + s} ${cy - Math.abs(k)} ${x + s} ${cy}C${x + s} ${cy + Math.abs(k)} ${x + k} ${cy + r} ${x} ${cy + r}Z`;
}

const CHARACTERS: Record<AvatarCharacter, Character> = {
  stack: {
    size: 3486,
    stroke: 160,
    eyes: pair(696.5),
    colors: { eyes: PINK, body: BLUE, wings: BLUE, ink: INK },
    figure: (c) =>
      rect(935, 1125, 1616, 489.42, c.body) +
      rect(935, 1837.52, 1616, 489.41, c.body) +
      rect(935, 2550.04, 1616, 489.41, c.body),
  },
  shield: {
    size: 3486,
    stroke: 160,
    eyes: pair(1425.5),
    colors: { eyes: PINK, body: BLUE, wings: ORANGE, ink: INK },
    figure: (c) =>
      rect(1189, 1898, 1126, 489, c.body) +
      path(
        "M966 2551C661.827 2408.46 450 2099.72 450 1742.07C450 1384.17 661.492 1077.41 966 935L966 2551Z",
        c.wings,
      ) +
      path(
        "M2538 2551C2842.17 2408.46 3054 2099.72 3054 1742.07C3054 1384.17 2842.51 1077.41 2538 935V2551Z",
        c.wings,
      ),
  },
  roller: {
    size: 3486,
    stroke: 160,
    eyes: pair(716.5),
    colors: { eyes: PINK, body: BLUE, wings: ORANGE, ink: INK },
    figure: (c) =>
      rect(933, 1189, 1616, 489, c.body) +
      path(
        "M933 1901C1075.54 2205.17 1384.28 2417 1741.93 2417C2099.83 2417 2406.59 2205.51 2549 1901H933Z",
        c.wings,
      ) +
      path(
        circlePath(1046.43, 2789.5, EYE_R),
        c.ink,
      ) +
      path(
        circlePath(2439.42, 2789.5, EYE_R),
        c.ink,
      ),
  },
  tower: {
    size: 3486,
    stroke: 160,
    eyes: pair(1743.5),
    colors: { eyes: PINK, body: BLUE, wings: BLUE, ink: INK },
    figure: (c) =>
      rect(2550, 936, 489, 1616, c.body) +
      rect(446, 935, 489.417, 1616, c.body),
  },
  wave: {
    size: 3486,
    stroke: 160,
    eyes: pair(1541.5),
    colors: { eyes: PINK, body: RUST, wings: RUST, ink: INK },
    figure: (c) =>
      path(
        "M1743 552C1279.54 552 875.172 799.73 655 1178.76V1389.86C917.95 1088.18 1307.39 895.43 1743 895.43C2178.61 895.43 2568.05 1088.18 2831 1389.86V1178.76C2610.83 799.73 2206.46 552 1743 552Z",
        c.body,
      ) +
      path(
        "M1743 2934C1279.54 2934 875.172 2686.27 655 2307.24V2096.14C917.95 2397.82 1307.39 2590.57 1743 2590.57C2178.61 2590.57 2568.05 2397.82 2831 2096.14V2307.24C2610.83 2686.27 2206.46 2934 1743 2934Z",
        c.body,
      ),
  },
  compass: {
    size: 125,
    stroke: 5.74,
    eyes: [
      [75.74, 62.52, 8.94],
      [49.25, 62.52, 8.94],
    ],
    colors: { eyes: PINK, body: GREEN, wings: GREEN, ink: INK },
    figure: (c) =>
      path(
        "M88.32 85.79L108.71 67.84L108.72 95.73C108.63 100.73 106.21 106.37 99.75 108.40C93.04 110.52 85.81 106.77 83.69 100.05C81.90 94.36 84.20 89.45 88.32 85.79Z",
        c.wings,
      ) +
      path(
        "M88.32 39.20L108.71 57.14L108.72 29.25C108.63 24.26 106.21 18.62 99.75 16.58C93.04 14.47 85.81 18.22 83.69 24.93C81.90 30.62 84.20 35.53 88.32 39.20Z",
        c.wings,
      ) +
      path(
        "M36.43 39.20L16.04 57.14L16.03 29.25C16.12 24.26 18.54 18.62 24.99 16.58C31.71 14.47 38.94 18.22 41.06 24.93C42.85 30.62 40.55 35.53 36.43 39.20Z",
        c.wings,
      ) +
      path(
        "M36.43 85.79L16.04 67.84L16.03 95.73C16.12 100.73 18.54 106.37 24.99 108.40C31.71 110.52 38.94 106.77 41.06 100.05C42.85 94.36 40.55 89.45 36.43 85.79Z",
        c.wings,
      ),
  },
  spark: {
    size: 3486,
    stroke: 160,
    eyes: [
      [2094, 680, 249],
      [1391, 680, 249],
    ],
    colors: { eyes: PINK, body: RUST, wings: GREEN, ink: INK },
    figure: (c) =>
      path(circlePath(1743, 1858, 611), c.body) +
      path(halfDisc(750, 1858, 620, -1), c.wings) +
      path(halfDisc(2736, 1858, 620, 1), c.wings),
  },
  lens: {
    size: 3486,
    stroke: 160,
    eyes: [
      [1100, 900, 340],
      [1900, 700, 280],
      [2500, 1150, 310],
      [700, 1700, 300],
      [1650, 1650, 380],
      [2350, 2100, 260],
      [1200, 2500, 320],
    ],
    colors: { eyes: PINK, body: BLUE, wings: ORANGE, ink: INK },
    figure: () => "",
  },
};

export function avatarKey(owner: string, name: string): string {
  return `${owner}\n${name}`;
}

export function avatarCharacter(seed: string): AvatarCharacter {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b);
  h ^= h >>> 16;
  return AVATAR_CHARACTERS[(h >>> 0) % AVATAR_CHARACTERS.length]!;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Both eye groups are always drawn and the one the
 * mood does not show carries display="none". That attribute alone is right for
 * a static render such as the Slack PNG, while page CSS outranks it, so the UI
 * can open an idle character's eyes on hover without a second drawing.
 */
export function avatarSvg(seed: string, mood: AvatarMood = "working"): string {
  const ch = CHARACTERS[avatarCharacter(seed)];
  const c =
    mood === "asleep"
      ? {
          eyes: ASLEEP_FILL,
          body: ASLEEP_FILL,
          wings: ASLEEP_FILL,
          ink: ASLEEP_FILL,
        }
      : ch.colors;
  const closed = ch.eyes
    .map(
      ([cx, cy, r]) =>
        `<path class="avatar-eye-closed" d="M${cx - r},${cy} A${r},${r} 0 0 0 ${cx + r},${cy}" fill="none" stroke="${c.eyes}" stroke-width="${ch.stroke}"/>`,
    )
    .join("");
  const open = ch.eyes
    .map(
      ([cx, cy, r]) =>
        `<circle class="avatar-eye" cx="${cx}" cy="${cy}" r="${r}" fill="${c.eyes}"/>`,
    )
    .join("");
  const hide = ' display="none"';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ch.size} ${ch.size}" fill="none">` +
    `<g class="avatar-eyes-closed"${mood === "working" ? hide : ""}>${closed}</g>` +
    `<g class="avatar-eyes-open"${mood === "working" ? "" : hide}>${open}</g>` +
    ch.figure(c) +
    "</svg>"
  );
}
