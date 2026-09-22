import type { HeadShape } from "./traits.js";

export interface HeadGeometry {
  path: string;
  halfWidth: number;
  top: number;
  bottom: number;
}

type Point = readonly [number, number];

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

export const HEAD_GEOMETRY: Record<HeadShape, HeadGeometry> = {
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
      7,
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
  bell: {
    path: "M22,64 V50 C22,33 34,21 50,21 C66,21 78,33 78,50 V64 Q78,76 66,76 H34 Q22,76 22,64 Z",
    halfWidth: 28,
    top: 21,
    bottom: 76,
  },
};
