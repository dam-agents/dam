import type { ReactNode } from "react";

import type { HeadGeometry } from "../../lib/avatar/geometry.js";
import {
  AVATAR_CENTER,
  capEdge,
  chinEdge,
  visorBox,
} from "../../lib/avatar/layout.js";
import { AVATAR_GAP, type AvatarTraits } from "../../lib/avatar/traits.js";

interface PartProps {
  traits: AvatarTraits;
  head: HeadGeometry;
}

const OUTSIDE_INK = "text-[#4a5160] dark:text-[#b3bac7]";

export function AvatarEars({ traits, head }: PartProps) {
  const left = AVATAR_CENTER - head.halfWidth - AVATAR_GAP;
  const right = AVATAR_CENTER + head.halfWidth + AVATAR_GAP;
  switch (traits.ears) {
    case "none":
      return null;
    case "block":
      return (
        <g fill={traits.palette.shade}>
          <rect x={left - 8.5} y={39} width={8.5} height={22} rx={4} />
          <rect x={right} y={39} width={8.5} height={22} rx={4} />
        </g>
      );
    case "round":
      return (
        <g fill={traits.palette.shade}>
          <path d={`M${left},40 A10,10 0 0 0 ${left},60 Z`} />
          <path d={`M${right},40 A10,10 0 0 1 ${right},60 Z`} />
        </g>
      );
  }
}

const STICK = 4.5;

function Stalk({
  side,
  base,
  tip,
  className,
  children,
}: {
  side: -1 | 1;
  base: readonly [number, number];
  tip: readonly [number, number];
  className?: string;
  children: (x: number, y: number) => ReactNode;
}) {
  const x1 = AVATAR_CENTER + side * base[0];
  const x2 = AVATAR_CENTER + side * tip[0];
  return (
    <g>
      <line
        x1={x1}
        y1={base[1]}
        x2={x2}
        y2={tip[1]}
        className={className}
        stroke="currentColor"
        strokeWidth={STICK}
        strokeLinecap="round"
      />
      {children(x2, tip[1])}
    </g>
  );
}

const SIDES = [-1, 1] as const;

export function AvatarTop({ traits, head }: PartProps) {
  const { top } = head;
  const clear = top - AVATAR_GAP;
  switch (traits.top) {
    case "none":
    case "cap":
      return null;
    case "antenna":
      return (
        <g fill={traits.accent}>
          <rect
            x={AVATAR_CENTER - STICK / 2}
            y={top - 13}
            width={STICK}
            height={13 - AVATAR_GAP}
            rx={STICK / 2}
          />
          <circle cx={AVATAR_CENTER} cy={top - 14} r={6} />
        </g>
      );
    case "twin":
      return (
        <g>
          {SIDES.map((side) => (
            <Stalk
              key={side}
              side={side}
              base={[9, clear - 1]}
              tip={[16, top - 12]}
              className={OUTSIDE_INK}
            >
              {(x, y) => <circle cx={x} cy={y} r={5.5} fill={traits.accent} />}
            </Stalk>
          ))}
        </g>
      );
    case "bolt":
      return (
        <rect
          x={AVATAR_CENTER - 8}
          y={clear - 7}
          width={16}
          height={7}
          rx={2.5}
          fill={traits.palette.shade}
        />
      );
  }
}

export function AvatarBottom({ traits, head }: PartProps) {
  const below = head.bottom + AVATAR_GAP;
  switch (traits.bottom) {
    case "neck":
    case "chin":
      return (
        <rect
          x={AVATAR_CENTER - 11}
          y={below}
          width={22}
          height={7}
          rx={3}
          className={OUTSIDE_INK}
          fill="currentColor"
        />
      );
    case "stripes":
      return (
        <g fill={traits.palette.shade}>
          <rect
            x={AVATAR_CENTER - 21}
            y={below}
            width={42}
            height={5.5}
            rx={2.75}
          />
          <rect
            x={AVATAR_CENTER - 16}
            y={below + 5.5 + AVATAR_GAP}
            width={32}
            height={5.5}
            rx={2.75}
          />
        </g>
      );
  }
}

export function AvatarOverlays({ traits, head }: PartProps) {
  const cap = capEdge(head);
  const chin = chinEdge(head);
  return (
    <>
      {traits.top === "cap" && (
        <path
          d={`M0,0 H100 V${cap} Q${AVATAR_CENTER},${cap + 7} 0,${cap} Z`}
          fill={traits.capColor}
        />
      )}
      {traits.bottom === "chin" && (
        <path
          d={`M0,${chin} Q${AVATAR_CENTER},${chin - 5} 100,${chin} V100 H0 Z`}
          fill={traits.palette.shade}
        />
      )}
    </>
  );
}

function ring(box: {
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
}) {
  const half = AVATAR_GAP / 2;
  return (
    <rect
      x={box.x - half}
      y={box.y - half}
      width={box.width + AVATAR_GAP}
      height={box.height + AVATAR_GAP}
      rx={box.rx + half}
    />
  );
}

export function AvatarGapLines({ traits, head }: PartProps) {
  const cap = capEdge(head);
  const chin = chinEdge(head);
  const hasVisor = traits.face === "visor" || traits.face === "happy";
  return (
    <g fill="none" stroke="black" strokeWidth={AVATAR_GAP}>
      {traits.top === "cap" && (
        <path d={`M0,${cap} Q${AVATAR_CENTER},${cap + 7} 100,${cap}`} />
      )}
      {traits.bottom === "chin" && (
        <path d={`M0,${chin} Q${AVATAR_CENTER},${chin - 5} 100,${chin}`} />
      )}
      {hasVisor && ring(visorBox(head))}
    </g>
  );
}
