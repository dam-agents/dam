import { AVATAR_GAP } from "./constants.js";
import { clearance, type HeadGeometry, type Point } from "./geometry.js";
import type { AvatarTraits, EyeSpec } from "./traits.js";

export const AVATAR_CENTER = 50;
export const AVATAR_VIEWBOX = "0 -4 100 100";
export const EDGE_MARGIN = 4;
export const GAP_MARGIN = 4;
export const MOUTH_Y = 65;

const CAP_DIP = 3.5;
const CHIN_RISE = 2.5;
const FIT_STEPS = 16;
const SHRINK = 0.94;
const MIN_VISOR_SHRINK = 8;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
}

export interface Range {
  top: number;
  bottom: number;
}

export function capEdge(head: HeadGeometry): number {
  return head.top + 12;
}

export function capCurve(head: HeadGeometry): string {
  const edge = capEdge(head);
  return `M0,${edge} Q${AVATAR_CENTER},${edge + CAP_DIP * 2} 100,${edge}`;
}

export function chinEdge(head: HeadGeometry): number {
  return head.bottom - 11;
}

export function chinCurve(head: HeadGeometry): string {
  const edge = chinEdge(head);
  return `M0,${edge} Q${AVATAR_CENTER},${edge - CHIN_RISE * 2} 100,${edge}`;
}

export function bandEdges(head: HeadGeometry): [number, number] {
  return [head.bottom - 23, head.bottom - 12];
}

export function beltEdges(head: HeadGeometry): [number, number] {
  return [head.bottom - 16, head.bottom - 9];
}

export function gapRanges(traits: AvatarTraits, head: HeadGeometry): Range[] {
  const half = AVATAR_GAP / 2;
  const ranges: Range[] = [];
  if (traits.top === "cap") {
    const edge = capEdge(head);
    ranges.push({ top: edge - half, bottom: edge + CAP_DIP + half });
  }
  if (traits.banding === "chin") {
    const edge = chinEdge(head);
    ranges.push({ top: edge - CHIN_RISE - half, bottom: edge + half });
  }
  if (traits.banding === "bands" || traits.banding === "belt") {
    const edges =
      traits.banding === "bands" ? bandEdges(head) : beltEdges(head);
    for (const edge of edges)
      ranges.push({ top: edge - half, bottom: edge + half });
  }
  return ranges;
}

export function faceZone(traits: AvatarTraits, head: HeadGeometry): Range {
  let top = head.top + EDGE_MARGIN;
  let bottom = head.bottom - EDGE_MARGIN;
  for (const gap of gapRanges(traits, head)) {
    if (gap.bottom < 50) top = Math.max(top, gap.bottom + GAP_MARGIN);
    else bottom = Math.min(bottom, gap.top - GAP_MARGIN);
  }
  if (traits.mouth !== "none")
    bottom = Math.min(bottom, MOUTH_Y - 3 - GAP_MARGIN);
  return { top, bottom };
}

function fitsInside(head: HeadGeometry, x: number, y: number, r: number) {
  return clearance(head, x, y) >= r + EDGE_MARGIN;
}

function arrangeEyes(
  eyes: readonly EyeSpec[],
  zone: Range,
  scale: number,
): EyeSpec[] {
  const minY = Math.min(...eyes.map((e) => e.y - e.r));
  const maxY = Math.max(...eyes.map((e) => e.y + e.r));
  const middle = (minY + maxY) / 2;
  const halfHeight = ((maxY - minY) / 2) * scale;
  const target = Math.min(
    Math.max(middle, zone.top + halfHeight),
    zone.bottom - halfHeight,
  );
  return eyes.map((e) => ({
    ...e,
    x: AVATAR_CENTER + e.x * scale,
    y: target + (e.y - middle) * scale,
    r: e.r * scale,
  }));
}

export function placeEyes(traits: AvatarTraits, head: HeadGeometry): EyeSpec[] {
  if (traits.eyes.length === 0) return [];
  const widen = Math.max(1, Math.min(1.15, head.halfWidth / 28));
  const eyes = traits.eyes.map((e) => ({ ...e, x: e.x * widen }));
  const minY = Math.min(...eyes.map((e) => e.y - e.r));
  const maxY = Math.max(...eyes.map((e) => e.y + e.r));
  const extentX = Math.max(...eyes.map((e) => Math.abs(e.x) + e.r));
  const zone = faceZone(traits, head);
  let scale = Math.min(
    1,
    (zone.bottom - zone.top) / (maxY - minY),
    (head.halfWidth - EDGE_MARGIN) / extentX,
  );
  let placed = arrangeEyes(eyes, zone, scale);
  for (let step = 0; step < FIT_STEPS; step++) {
    if (placed.every((e) => fitsInside(head, e.x, e.y, e.r))) break;
    scale *= SHRINK;
    placed = arrangeEyes(eyes, zone, scale);
  }
  return placed;
}

function visorFits(head: HeadGeometry, box: Box): boolean {
  const inset = box.rx;
  const need = box.rx + AVATAR_GAP + 2;
  return [
    [box.x + inset, box.y + inset],
    [box.x + box.width - inset, box.y + inset],
    [box.x + inset, box.y + box.height - inset],
    [box.x + box.width - inset, box.y + box.height - inset],
  ].every(([x, y]) => clearance(head, x!, y!) >= need);
}

export function visorBox(traits: AvatarTraits, head: HeadGeometry): Box {
  const zone = faceZone(traits, head);
  const inner = {
    top: zone.top + AVATAR_GAP - 1,
    bottom: zone.bottom - AVATAR_GAP + 1,
  };
  const height = Math.min(20, inner.bottom - inner.top);
  const y = Math.min(Math.max(39, inner.top), inner.bottom - height);
  let halfWidth = head.halfWidth - 8;
  let box: Box = {
    x: AVATAR_CENTER - halfWidth,
    y,
    width: halfWidth * 2,
    height,
    rx: height / 2,
  };
  while (!visorFits(head, box) && halfWidth > head.halfWidth * 0.5) {
    halfWidth -= 1;
    box = { ...box, x: AVATAR_CENTER - halfWidth, width: halfWidth * 2 };
  }
  while (!visorFits(head, box) && box.height > MIN_VISOR_SHRINK) {
    const height = box.height - 1;
    box = { ...box, height, rx: height / 2 };
  }
  return box;
}

export const WINK_HEIGHT = 12;

export function faceCenterY(traits: AvatarTraits, head: HeadGeometry): number {
  const zone = faceZone(traits, head);
  const half = WINK_HEIGHT / 2;
  return Math.min(Math.max(48, zone.top + half), zone.bottom - half);
}

export interface Wink {
  dot: { cx: number; cy: number; r: number };
  dash: Box;
}

export function winkLayout(traits: AvatarTraits, head: HeadGeometry): Wink {
  const y = faceCenterY(traits, head);
  const build = (spread: number): Wink => ({
    dot: { cx: AVATAR_CENTER - spread, cy: y, r: 6 },
    dash: {
      x: AVATAR_CENTER + spread - 7,
      y: y - 2.75,
      width: 14,
      height: 5.5,
      rx: 2.75,
    },
  });
  let spread = 12;
  let wink = build(spread);
  while (
    spread > 8 &&
    !(
      fitsInside(head, wink.dot.cx, y, wink.dot.r) &&
      fitsInside(head, wink.dash.x + wink.dash.width - 2.75, y, 2.75)
    )
  ) {
    spread -= 0.5;
    wink = build(spread);
  }
  return wink;
}

export function mouthFits(head: HeadGeometry): boolean {
  return (
    fitsInside(head, AVATAR_CENTER - 8, MOUTH_Y + 2.75, 2.75) &&
    fitsInside(head, AVATAR_CENTER + 8, MOUTH_Y + 2.75, 2.75)
  );
}

export function wingPath(head: HeadGeometry, side: -1 | 1): string {
  const inner = AVATAR_CENTER + side * (head.halfWidth + AVATAR_GAP + 2.5);
  const room = side > 0 ? 98 - inner : inner - 2;
  const radius = Math.min(8, room / 2);
  const lobe: Point = [inner + side * radius, (head.top + head.bottom) / 2 + 8];
  const tip: Point = [inner, head.top + 12];
  const [outerX, outerY] = outerTangent(tip, lobe, radius, side);
  const sweep = side > 0 ? 0 : 1;
  const f = (n: number) => Math.round(n * 100) / 100;
  return `M${f(tip[0])},${f(tip[1])} L${f(inner)},${f(lobe[1])} A${f(radius)},${f(radius)} 0 1 ${sweep} ${f(outerX)},${f(outerY)} Z`;
}

function outerTangent(
  tip: Point,
  center: Point,
  radius: number,
  side: -1 | 1,
): Point {
  const dx = center[0] - tip[0];
  const dy = center[1] - tip[1];
  const distance = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const reach = Math.sqrt(distance * distance - radius * radius);
  const spread = Math.asin(radius / distance);
  const a = angle - side * spread;
  return [tip[0] + reach * Math.cos(a), tip[1] + reach * Math.sin(a)];
}

export const IMAGE_TOP = -4;
const BRIM_HEIGHT = 6.5;
const BRIM_HALF_WIDTH = 21;
const CROWN_HALF_WIDTH = 12;
const CROWN_MAX_HEIGHT = 13;

export function hatLayout(head: HeadGeometry): { brim: Box; crown: Box } {
  const brimY = head.top - AVATAR_GAP - BRIM_HEIGHT;
  const crownBottom = brimY - AVATAR_GAP;
  const crownHeight = Math.min(CROWN_MAX_HEIGHT, crownBottom - IMAGE_TOP - 1);
  return {
    brim: {
      x: AVATAR_CENTER - BRIM_HALF_WIDTH,
      y: brimY,
      width: BRIM_HALF_WIDTH * 2,
      height: BRIM_HEIGHT,
      rx: BRIM_HEIGHT / 2,
    },
    crown: {
      x: AVATAR_CENTER - CROWN_HALF_WIDTH,
      y: crownBottom - crownHeight,
      width: CROWN_HALF_WIDTH * 2,
      height: crownHeight,
      rx: 4,
    },
  };
}

export const BUG_EYE_SPREAD = 11;

export function bugEyeCenter(
  head: HeadGeometry,
  index: number,
  r: number,
): [number, number] {
  return [
    AVATAR_CENTER + (index === 0 ? -BUG_EYE_SPREAD : BUG_EYE_SPREAD),
    head.top - AVATAR_GAP - 1 - r,
  ];
}

export const STRAP_WIDTH = 4;
const STRAP_REACH = 80;
const MOUTH_CLEARANCE = 10;
const STRAP_TILTS = [45, 35, 55, 25].map((deg) => (deg * Math.PI) / 180);

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function distanceToLine(px: number, py: number, line: Segment): number {
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  return (
    Math.abs(dy * (px - line.x1) - dx * (py - line.y1)) / Math.hypot(dx, dy)
  );
}

export function strapLine(
  traits: AvatarTraits,
  head: HeadGeometry,
  patch: number,
): Segment | null {
  const placed = placeEyes(traits, head);
  const covered = placed[patch];
  if (!covered) return null;
  const others = placed.filter((_, i) => i !== patch);
  const side = covered.x < AVATAR_CENTER ? -1 : 1;
  for (const toward of [-side, side])
    for (const tilt of STRAP_TILTS) {
      const dx = toward * Math.sin(tilt) * STRAP_REACH;
      const dy = -Math.cos(tilt) * STRAP_REACH;
      const line = {
        x1: covered.x - dx,
        y1: covered.y - dy,
        x2: covered.x + dx,
        y2: covered.y + dy,
      };
      const clearOfEyes = others.every(
        (e) =>
          distanceToLine(e.x, e.y, line) >= e.r + STRAP_WIDTH / 2 + AVATAR_GAP,
      );
      const clearOfMouth =
        traits.mouth === "none" ||
        distanceToLine(AVATAR_CENTER, MOUTH_Y + 2.5, line) >=
          MOUTH_CLEARANCE + STRAP_WIDTH / 2;
      if (clearOfEyes && clearOfMouth) return line;
    }
  return null;
}
