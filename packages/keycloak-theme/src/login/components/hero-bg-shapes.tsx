const PIECES: Record<string, { d: string; viewBox: string }> = {
  teardrop: {
    d: "M88.32 85.79L108.71 67.84L108.72 95.73C108.63 100.73 106.21 106.37 99.75 108.40C93.04 110.52 85.81 106.77 83.69 100.05C81.90 94.36 84.20 89.45 88.32 85.79Z",
    viewBox: "81.5 67.5 27.5 43.5",
  },
  singleWing: {
    d: "M88.32 39.20L108.71 57.14L108.72 29.25C108.63 24.26 106.21 18.62 99.75 16.58C93.04 14.47 85.81 18.22 83.69 24.93C81.90 30.62 84.20 35.53 88.32 39.20Z",
    viewBox: "83 14 26 44",
  },
  compassWings: {
    d: "M88.32 39.20L108.71 57.14L108.72 29.25C108.63 24.26 106.21 18.62 99.75 16.58C93.04 14.47 85.81 18.22 83.69 24.93C81.90 30.62 84.20 35.53 88.32 39.20Z M88.32 85.79L108.71 67.84L108.72 95.73C108.63 100.73 106.21 106.37 99.75 108.40C93.04 110.52 85.81 106.77 83.69 100.05C81.90 94.36 84.20 89.45 88.32 85.79Z M36.43 39.20L16.04 57.14L16.03 29.25C16.12 24.26 18.54 18.62 24.99 16.58C31.71 14.47 38.94 18.22 41.06 24.93C42.85 30.62 40.55 35.53 36.43 39.20Z M36.43 85.79L16.04 67.84L16.03 95.73C16.12 100.73 18.54 106.37 24.99 108.40C31.71 110.52 38.94 106.77 41.06 100.05C42.85 94.36 40.55 89.45 36.43 85.79Z",
    viewBox: "16 16 93 93",
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
  eye: {
    d: "M250 0C112 0 0 112 0 250C0 388 112 500 250 500C388 500 500 388 500 250C500 112 388 0 250 0Z",
    viewBox: "0 0 500 500",
  },
};

const BLUE = "#5B76D2";
const GOLD = "#DE9950";
const RUST = "#CA6040";
const GREEN = "#3F6C45";
const PINK = "#E89DA8";

const DESIGN_WIDTH = 820;
const DESIGN_HEIGHT = 520;

interface ShapeConfig {
  piece: keyof typeof PIECES;
  color: string;
  x: number;
  y: number;
  size: number;
  flip?: boolean;
}

const SHAPES: ShapeConfig[] = [
  { piece: "crescent", color: RUST, x: 93, y: -299, size: 440 },
  { piece: "eye", color: PINK, x: 553, y: -269, size: 180 },
  { piece: "singleWing", color: GREEN, x: 768, y: -299, size: 550, flip: true },
  { piece: "bar", color: BLUE, x: -27, y: -44, size: 340 },
  { piece: "singleWing", color: GREEN, x: 57, y: 71, size: 400, flip: true },
  { piece: "shortBar", color: GOLD, x: 173, y: 101, size: 360 },
  { piece: "bar", color: BLUE, x: 473, y: 261, size: 460 },
  { piece: "halfDisc", color: GOLD, x: 473, y: 411, size: 460 },
];

const cqw = (px: number) => `${(px / DESIGN_WIDTH) * 100}cqw`;

function Shape({ piece, color, x, y, size, flip = false }: ShapeConfig) {
  const p = PIECES[piece]!;
  const [, , vw, vh] = p.viewBox.split(" ").map(Number) as [
    number,
    number,
    number,
    number,
  ];
  const aspect = vw / vh;
  const width = aspect >= 1 ? size : size * aspect;
  const height = aspect >= 1 ? size / aspect : size;

  return (
    <div
      className="absolute"
      style={{
        left: cqw(x),
        top: `calc(50% + ${cqw(y - DESIGN_HEIGHT / 2)})`,
        width: cqw(width),
        height: cqw(height),
        transform: flip ? "scaleX(-1)" : undefined,
      }}
      aria-hidden="true"
    >
      <svg
        viewBox={p.viewBox}
        className="h-full w-full"
        preserveAspectRatio="none"
      >
        <path d={p.d} fill={color} />
      </svg>
    </div>
  );
}

/* UNIT_BOUNDARY_DESCRIPTION: The coloured shapes behind the Slack
 * illustration on the login page's first screen. The design places them around
 * the illustration at its full size (DESIGN_WIDTH x DESIGN_HEIGHT px). Each
 * shape keeps that place relative to the illustration and scales with its
 * width in container query units, anchored on its vertical middle because the
 * illustration keeps a fixed height. So the shapes frame the illustration at
 * every page width and never spread over the sign-in form. Render it inside the
 * illustration's box, which must be an inline-size container. */
export function HeroBgShapes() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {SHAPES.map((s, i) => (
        <Shape key={i} {...s} />
      ))}
    </div>
  );
}
