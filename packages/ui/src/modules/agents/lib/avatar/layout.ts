import type { HeadGeometry } from "./geometry.js";

export const AVATAR_CENTER = 50;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
}

export function visorBox(head: HeadGeometry): Box {
  const halfWidth = head.halfWidth - 8.5;
  return {
    x: AVATAR_CENTER - halfWidth,
    y: 39,
    width: halfWidth * 2,
    height: 20,
    rx: 10,
  };
}

export function capEdge(head: HeadGeometry): number {
  return head.top + 13;
}

export function chinEdge(head: HeadGeometry): number {
  return head.bottom - 11;
}

export function eyeScale(head: HeadGeometry): number {
  return Math.min(1.15, head.halfWidth / 28);
}
