import type { HeadShape } from "./traits.js";

export type Point = readonly [number, number];

export interface HeadGeometry {
  path: string;
  halfWidth: number;
  top: number;
  bottom: number;
  outline: readonly Point[];
}

function roundedPolygon(points: readonly Point[], radius: number): string {
  const n = points.length;
  const segments = points.map((corner, i) => {
    const prev = points[(i + n - 1) % n]!;
    const next = points[(i + 1) % n]!;
    const toward = (target: Point): Point => {
      const dx = target[0] - corner[0];
      const dy = target[1] - corner[1];
      const length = Math.hypot(dx, dy);
      const t = Math.min(radius, length / 2) / length;
      return [corner[0] + dx * t, corner[1] + dy * t];
    };
    const start = toward(prev);
    const end = toward(next);
    return `${i === 0 ? "M" : "L"}${start[0]},${start[1]} Q${corner[0]},${corner[1]} ${end[0]},${end[1]}`;
  });
  return `${segments.join(" ")} Z`;
}

function roundedRect(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): string {
  return roundedPolygon(
    [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ],
    r,
  );
}

const SHAPES: Record<HeadShape, Omit<HeadGeometry, "outline">> = {
  circle: {
    path: "M22,49 A28,28 0 1,0 78,49 A28,28 0 1,0 22,49 Z",
    halfWidth: 28,
    top: 21,
    bottom: 77,
  },
  squircle: {
    path: roundedRect(22, 22, 56, 54, 22),
    halfWidth: 28,
    top: 22,
    bottom: 76,
  },
  octagon: {
    path: roundedPolygon(
      [
        [37, 22],
        [63, 22],
        [78, 37],
        [78, 61],
        [63, 76],
        [37, 76],
        [22, 61],
        [22, 37],
      ],
      3,
    ),
    halfWidth: 28,
    top: 22,
    bottom: 76,
  },
  egg: {
    path: "M21,46 C21,30 34,20 50,20 C66,20 79,30 79,46 C79,60 72,76 60,76 H40 C28,76 21,60 21,46 Z",
    halfWidth: 29,
    top: 20,
    bottom: 76,
  },
  box: {
    path: roundedRect(17, 27, 66, 48, 16),
    halfWidth: 33,
    top: 27,
    bottom: 75,
  },
  capsule: {
    path: roundedRect(30, 22, 40, 56, 20),
    halfWidth: 20,
    top: 22,
    bottom: 78,
  },
  bell: {
    path: "M22,64 V50 C22,33 34,21 50,21 C66,21 78,33 78,50 V64 Q78,76 66,76 H34 Q22,76 22,64 Z",
    halfWidth: 28,
    top: 21,
    bottom: 76,
  },
};

const CURVE_STEPS = 12;

function samplePath(d: string): Point[] {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+/g) ?? [];
  const points: Point[] = [];
  let i = 0;
  let command = "";
  let cursor: Point = [0, 0];
  const read = () => Number(tokens[i++]);
  const push = (p: Point) => {
    points.push(p);
    cursor = p;
  };
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i]!)) command = tokens[i++]!;
    switch (command) {
      case "M":
      case "L":
        push([read(), read()]);
        break;
      case "H":
        push([read(), cursor[1]]);
        break;
      case "V":
        push([cursor[0], read()]);
        break;
      case "Q": {
        const from = cursor;
        const c: Point = [read(), read()];
        const to: Point = [read(), read()];
        for (let k = 1; k <= CURVE_STEPS; k++) {
          const t = k / CURVE_STEPS;
          const u = 1 - t;
          push([
            u * u * from[0] + 2 * u * t * c[0] + t * t * to[0],
            u * u * from[1] + 2 * u * t * c[1] + t * t * to[1],
          ]);
        }
        break;
      }
      case "C": {
        const from = cursor;
        const c1: Point = [read(), read()];
        const c2: Point = [read(), read()];
        const to: Point = [read(), read()];
        for (let k = 1; k <= CURVE_STEPS; k++) {
          const t = k / CURVE_STEPS;
          const u = 1 - t;
          push([
            u * u * u * from[0] +
              3 * u * u * t * c1[0] +
              3 * u * t * t * c2[0] +
              t * t * t * to[0],
            u * u * u * from[1] +
              3 * u * u * t * c1[1] +
              3 * u * t * t * c2[1] +
              t * t * t * to[1],
          ]);
        }
        break;
      }
      case "Z":
        i++;
        break;
      default:
        i++;
    }
  }
  return points;
}

function circleOutline(cx: number, cy: number, r: number): Point[] {
  return Array.from({ length: 72 }, (_, k) => {
    const a = (k / 72) * Math.PI * 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
  });
}

function traced(geometry: Omit<HeadGeometry, "outline">): HeadGeometry {
  return { ...geometry, outline: samplePath(geometry.path) };
}

export const HEAD_GEOMETRY: Record<HeadShape, HeadGeometry> = {
  circle: { ...SHAPES.circle, outline: circleOutline(50, 49, 28) },
  squircle: traced(SHAPES.squircle),
  octagon: traced(SHAPES.octagon),
  egg: traced(SHAPES.egg),
  box: traced(SHAPES.box),
  bell: traced(SHAPES.bell),
  capsule: traced(SHAPES.capsule),
};

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const t =
    length === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length),
        );
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function clearance(head: HeadGeometry, x: number, y: number): number {
  const { outline } = head;
  let inside = false;
  let nearest = Infinity;
  for (let k = 0, j = outline.length - 1; k < outline.length; j = k++) {
    const a = outline[j]!;
    const b = outline[k]!;
    if (
      a[1] > y !== b[1] > y &&
      x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
    nearest = Math.min(nearest, segmentDistance([x, y], a, b));
  }
  return inside ? nearest : -nearest;
}
