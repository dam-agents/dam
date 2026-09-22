import { AVATAR_GAP } from "./constants.js";
import { type HeadGeometry, teardrop } from "./geometry.js";
import type { AvatarTraits, EyeSpec } from "./traits.js";

export const AVATAR_CENTER = 50;

const CAP_DIP = 3.5;
const CHIN_RISE = 2.5;
const CLEARANCE = 2.5;

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
  if (traits.banding === "bands") {
    for (const edge of bandEdges(head))
      ranges.push({ top: edge - half, bottom: edge + half });
  }
  return ranges;
}

export function faceZone(traits: AvatarTraits, head: HeadGeometry): Range {
  let top = head.top + 6;
  let bottom = head.bottom - 6;
  for (const gap of gapRanges(traits, head)) {
    if (gap.bottom < 50) top = Math.max(top, gap.bottom + CLEARANCE);
    else bottom = Math.min(bottom, gap.top - CLEARANCE);
  }
  if (traits.mouth !== "none") bottom = Math.min(bottom, 61);
  return { top, bottom };
}

function fitScale(
  zone: Range,
  height: number,
  halfWidth: number,
  extentX: number,
): number {
  return Math.min(1, (zone.bottom - zone.top) / height, halfWidth / extentX);
}

export function placeEyes(traits: AvatarTraits, head: HeadGeometry): EyeSpec[] {
  if (traits.eyes.length === 0) return [];
  const widen = Math.min(1.15, head.halfWidth / 28);
  const eyes = traits.eyes.map((e) => ({ ...e, x: e.x * widen }));
  const minY = Math.min(...eyes.map((e) => e.y - e.r));
  const maxY = Math.max(...eyes.map((e) => e.y + e.r));
  const extentX = Math.max(...eyes.map((e) => Math.abs(e.x) + e.r));
  const zone = faceZone(traits, head);
  const scale = fitScale(zone, maxY - minY, head.halfWidth - 3, extentX);
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

export function visorBox(traits: AvatarTraits, head: HeadGeometry): Box {
  const zone = faceZone(traits, head);
  const inner = {
    top: zone.top + AVATAR_GAP,
    bottom: zone.bottom - AVATAR_GAP,
  };
  const height = Math.min(20, inner.bottom - inner.top);
  const y = Math.min(Math.max(39, inner.top), inner.bottom - height);
  const halfWidth = Math.max(head.halfWidth - 8.5, head.halfWidth * 0.72);
  return {
    x: AVATAR_CENTER - halfWidth,
    y,
    width: halfWidth * 2,
    height,
    rx: height / 2,
  };
}

export function faceCenterY(traits: AvatarTraits, head: HeadGeometry): number {
  const zone = faceZone(traits, head);
  return Math.min(Math.max(48, zone.top + 7), zone.bottom - 7);
}

export function wingPath(head: HeadGeometry, side: -1 | 1): string {
  const tip: readonly [number, number] = [
    AVATAR_CENTER + side * (head.halfWidth + AVATAR_GAP + 1.5),
    head.top + 14,
  ];
  const lobe: readonly [number, number] = [
    AVATAR_CENTER + side * Math.min(head.halfWidth + 14, 38),
    (head.top + head.bottom) / 2 + 8,
  ];
  return teardrop(tip, lobe, 8.5);
}

export const BUG_EYE_SPREAD = 9;

export function bugEyeCenter(
  head: HeadGeometry,
  index: number,
  r: number,
): [number, number] {
  return [
    AVATAR_CENTER + (index === 0 ? -BUG_EYE_SPREAD : BUG_EYE_SPREAD),
    head.top - AVATAR_GAP - r,
  ];
}
