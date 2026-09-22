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
  const halfWidth = head.halfWidth - 6;
  return {
    x: AVATAR_CENTER - halfWidth,
    y: 39,
    width: halfWidth * 2,
    height: 20,
    rx: 10,
  };
}

export const STRIPE_ROWS: readonly number[] = [36, 46.5, 57];
export const STRIPE_HEIGHT = 6.5;
export const STRIPE_INSET = 0.84;

export function stripeTransform(head: HeadGeometry): string {
  const midY = (head.top + head.bottom) / 2;
  return `translate(${AVATAR_CENTER} ${midY}) scale(${STRIPE_INSET} 1) translate(${-AVATAR_CENTER} ${-midY})`;
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
