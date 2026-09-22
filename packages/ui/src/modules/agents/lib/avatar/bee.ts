import { AVATAR_CENTER } from "./layout.js";
import { AVATAR_GAP } from "./traits.js";

type Point = readonly [number, number];

export const BEE_HALF_WIDTH = 15;
export const BEE_TOP = 30;
const DOME = BEE_HALF_WIDTH;
const BAR = 8;

export interface BeeBody {
  topDome: string;
  bars: { y: number; height: number }[];
  bottomDome: string;
}

export function beeBody(): BeeBody {
  const left = AVATAR_CENTER - BEE_HALF_WIDTH;
  const right = AVATAR_CENTER + BEE_HALF_WIDTH;
  const topFlat = BEE_TOP + DOME;
  const bar1 = topFlat + AVATAR_GAP;
  const bar2 = bar1 + BAR + AVATAR_GAP;
  const bottomFlat = bar2 + BAR + AVATAR_GAP;
  return {
    topDome: `M${left},${topFlat} A${DOME},${DOME} 0 0 1 ${right},${topFlat} Z`,
    bars: [
      { y: bar1, height: BAR },
      { y: bar2, height: BAR },
    ],
    bottomDome: `M${left},${bottomFlat} A${DOME},${DOME} 0 0 0 ${right},${bottomFlat} Z`,
  };
}

export function teardrop(tip: Point, center: Point, radius: number): string {
  const dx = center[0] - tip[0];
  const dy = center[1] - tip[1];
  const distance = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const spread = Math.asin(radius / distance);
  const reach = Math.sqrt(distance * distance - radius * radius);
  const tangent = (a: number): Point => [
    tip[0] + reach * Math.cos(a),
    tip[1] + reach * Math.sin(a),
  ];
  const [x1, y1] = tangent(angle - spread);
  const [x2, y2] = tangent(angle + spread);
  return `M${tip[0]},${tip[1]} L${x1},${y1} A${radius},${radius} 0 1 1 ${x2},${y2} Z`;
}

export function beeWing(side: -1 | 1): string {
  const tip: Point = [AVATAR_CENTER + side * (BEE_HALF_WIDTH + 2), BEE_TOP + 8];
  const lobe: Point = [AVATAR_CENTER + side * 31, BEE_TOP + 29];
  return teardrop(tip, lobe, 8.5);
}
