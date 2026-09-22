import type { HeadShape } from "./traits.js";

export interface HeadGeometry {
  path: string;
  halfWidth: number;
  top: number;
  bottom: number;
}

function roundedRect(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): string {
  return [
    `M${x + r},${y}`,
    `H${x + w - r}`,
    `Q${x + w},${y} ${x + w},${y + r}`,
    `V${y + h - r}`,
    `Q${x + w},${y + h} ${x + w - r},${y + h}`,
    `H${x + r}`,
    `Q${x},${y + h} ${x},${y + h - r}`,
    `V${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    "Z",
  ].join(" ");
}

export const HEAD_GEOMETRY: Record<HeadShape, HeadGeometry> = {
  circle: {
    path: "M22,49 A28,28 0 1,0 78,49 A28,28 0 1,0 22,49 Z",
    halfWidth: 28,
    top: 21,
    bottom: 77,
  },
  squircle: {
    path: roundedRect(22, 22, 56, 54, 16),
    halfWidth: 28,
    top: 22,
    bottom: 76,
  },
  octagon: {
    path: "M37,22 H63 L78,37 V61 L63,76 H37 L22,61 V37 Z",
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
    path: roundedRect(17, 28, 66, 46, 9),
    halfWidth: 33,
    top: 28,
    bottom: 74,
  },
  bell: {
    path: "M22,68 V50 C22,33 34,21 50,21 C66,21 78,33 78,50 V68 Q78,76 70,76 H30 Q22,76 22,68 Z",
    halfWidth: 28,
    top: 21,
    bottom: 76,
  },
};
