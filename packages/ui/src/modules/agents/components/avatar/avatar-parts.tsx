import type { ReactNode } from "react";

import type { HeadGeometry } from "../../lib/avatar/geometry.js";
import {
  AVATAR_INK,
  AVATAR_SCLERA,
  type AvatarTraits,
} from "../../lib/avatar/traits.js";

interface PartProps {
  traits: AvatarTraits;
  head: HeadGeometry;
}

const CENTER = 50;
const OUTSIDE_INK = "text-[#13254b] dark:text-[#aebbd3]";
const EYE_Y = 48;

export function AvatarEars({ traits, head }: PartProps) {
  const fill = traits.palette.shade;
  const left = CENTER - head.halfWidth;
  const right = CENTER + head.halfWidth;
  switch (traits.ears) {
    case "none":
      return null;
    case "block":
      return (
        <g fill={fill}>
          <rect x={left - 8} y={39} width={11} height={22} rx={4} />
          <rect x={right - 3} y={39} width={11} height={22} rx={4} />
        </g>
      );
    case "round":
      return (
        <g fill={fill}>
          <circle cx={left + 1} cy={50} r={10} />
          <circle cx={right - 1} cy={50} r={10} />
        </g>
      );
  }
}

function Eye({
  cx,
  cy,
  r,
  gaze,
}: {
  cx: number;
  cy: number;
  r: number;
  gaze: AvatarTraits["gaze"];
}) {
  const pupil = r * 0.47;
  const reach = (r - pupil) * 0.45;
  return (
    <>
      <circle cx={cx} cy={cy} r={r} fill={AVATAR_SCLERA} />
      <circle
        cx={cx + (gaze.dx / 3) * reach}
        cy={cy + (gaze.dy / 2) * reach}
        r={pupil}
        fill={AVATAR_INK}
      />
    </>
  );
}

function Visor({ head, children }: PartProps & { children: ReactNode }) {
  const inset = 5;
  const width = (head.halfWidth - inset) * 2;
  return (
    <>
      <rect
        x={CENTER - width / 2}
        y={38}
        width={width}
        height={22}
        rx={11}
        fill={AVATAR_INK}
      />
      {children}
    </>
  );
}

export function AvatarFace({ traits, head }: PartProps) {
  const spread = Math.min(15, head.halfWidth - 14);
  const shift = traits.gaze.dx;
  switch (traits.face) {
    case "eyes":
      return (
        <>
          <Eye
            cx={CENTER - spread}
            cy={EYE_Y}
            r={11 * traits.eyeSizes.left}
            gaze={traits.gaze}
          />
          <Eye
            cx={CENTER + spread}
            cy={EYE_Y}
            r={11 * traits.eyeSizes.right}
            gaze={traits.gaze}
          />
        </>
      );
    case "cyclops":
      return <Eye cx={CENTER} cy={47} r={16} gaze={traits.gaze} />;
    case "visor":
      return (
        <Visor traits={traits} head={head}>
          <g fill={traits.palette.light}>
            <circle cx={CENTER - spread + shift} cy={49} r={5.5} />
            <circle cx={CENTER + spread + shift} cy={49} r={5.5} />
          </g>
        </Visor>
      );
    case "happy":
      return (
        <Visor traits={traits} head={head}>
          <g
            fill="none"
            stroke={traits.palette.light}
            strokeWidth={3.5}
            strokeLinecap="round"
          >
            <path d={`M${CENTER - spread - 6},53 a6,6 0 0 1 12,0`} />
            <path d={`M${CENTER + spread - 6},53 a6,6 0 0 1 12,0`} />
          </g>
        </Visor>
      );
    case "wink":
      return (
        <g fill={AVATAR_INK}>
          <circle cx={CENTER - spread} cy={EYE_Y} r={6.5} />
          <rect
            x={CENTER + spread - 8}
            y={EYE_Y - 2.5}
            width={16}
            height={5}
            rx={2.5}
          />
        </g>
      );
    case "stripes":
      return (
        <g fill={AVATAR_INK}>
          {[35, 46, 57].map((y) => (
            <rect key={y} x={0} y={y} width={100} height={6.5} />
          ))}
        </g>
      );
  }
}

export function AvatarMouth({ traits }: PartProps) {
  const y = traits.face === "cyclops" ? 67 : 64;
  switch (traits.mouth) {
    case "none":
      return null;
    case "line":
      return (
        <rect
          x={CENTER - 9}
          y={y}
          width={18}
          height={4.5}
          rx={2.25}
          fill={AVATAR_INK}
        />
      );
    case "grille":
      return (
        <g>
          <rect
            x={CENTER - 11}
            y={y - 1}
            width={22}
            height={7}
            rx={2.5}
            fill={AVATAR_INK}
          />
          <g fill={traits.palette.base}>
            <rect x={CENTER - 4.5} y={y} width={2} height={5} />
            <rect x={CENTER + 2.5} y={y} width={2} height={5} />
          </g>
        </g>
      );
  }
}

export function AvatarCapOverlay({ traits, head }: PartProps) {
  if (traits.top !== "cap") return null;
  const edge = head.top + 14;
  return (
    <path
      d={`M0,0 H100 V${edge} Q${CENTER},${edge + 7} 0,${edge} Z`}
      fill={traits.capColor}
    />
  );
}

export function AvatarChinOverlay({ traits, head }: PartProps) {
  if (traits.bottom !== "chin") return null;
  const edge = head.bottom - 12;
  return (
    <path
      d={`M0,${edge} Q${CENTER},${edge - 5} 100,${edge} V100 H0 Z`}
      fill={traits.palette.shade}
    />
  );
}

export function AvatarTop({ traits, head }: PartProps) {
  const { top } = head;
  switch (traits.top) {
    case "none":
    case "cap":
      return null;
    case "antenna":
      return (
        <g fill={traits.accent}>
          <rect x={CENTER - 1.75} y={top - 11} width={3.5} height={13} />
          <circle cx={CENTER} cy={top - 13} r={5.5} />
        </g>
      );
    case "twin":
      return (
        <g>
          <g
            className={OUTSIDE_INK}
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
          >
            <line x1={CENTER - 9} y1={top + 3} x2={CENTER - 15} y2={top - 10} />
            <line x1={CENTER + 9} y1={top + 3} x2={CENTER + 15} y2={top - 10} />
          </g>
          <g fill={traits.accent}>
            <circle cx={CENTER - 15} cy={top - 12} r={5} />
            <circle cx={CENTER + 15} cy={top - 12} r={5} />
          </g>
        </g>
      );
    case "bolt":
      return (
        <rect
          x={CENTER - 8}
          y={top - 7}
          width={16}
          height={10}
          rx={2}
          fill={traits.palette.shade}
        />
      );
    case "stalks":
      return (
        <g>
          <g
            stroke={traits.palette.light}
            strokeWidth={3}
            strokeLinecap="round"
          >
            <line x1={CENTER - 8} y1={top + 4} x2={CENTER - 16} y2={top - 7} />
            <line x1={CENTER + 8} y1={top + 4} x2={CENTER + 16} y2={top - 7} />
          </g>
          {[CENTER - 18, CENTER + 18].map((cx) => (
            <g key={cx}>
              <circle cx={cx} cy={top - 11} r={8} fill={traits.accent} />
              <circle cx={cx} cy={top - 11} r={5} fill={AVATAR_SCLERA} />
              <circle
                cx={cx + traits.gaze.dx * 0.6}
                cy={top - 11 + traits.gaze.dy * 0.6}
                r={2.5}
                fill={AVATAR_INK}
              />
            </g>
          ))}
        </g>
      );
  }
}

export function AvatarBottom({ traits, head }: PartProps) {
  const { bottom } = head;
  switch (traits.bottom) {
    case "neck":
    case "chin":
      return (
        <rect
          x={CENTER - 11}
          y={bottom - 1}
          width={22}
          height={9}
          rx={2}
          className={OUTSIDE_INK}
          fill="currentColor"
        />
      );
    case "stripes":
      return (
        <g fill={traits.palette.shade}>
          <rect x={CENTER - 22} y={bottom + 3} width={44} height={4} rx={2} />
          <rect x={CENTER - 18} y={bottom + 10} width={36} height={4} rx={2} />
        </g>
      );
  }
}
