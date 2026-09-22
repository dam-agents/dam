import type { HeadGeometry } from "../../lib/avatar/geometry.js";
import {
  AVATAR_CENTER,
  bandEdges,
  bugEyeCenter,
  capCurve,
  capEdge,
  chinCurve,
  chinEdge,
  visorBox,
  wingPath,
} from "../../lib/avatar/layout.js";
import { AVATAR_GAP, type AvatarTraits } from "../../lib/avatar/traits.js";
import { Pupil } from "./avatar-face.js";

interface PartProps {
  traits: AvatarTraits;
  head: HeadGeometry;
}

const OUTSIDE_INK = "text-[#4a5160] dark:text-[#b3bac7]";
const STICK = 4.5;
const SIDES = [-1, 1] as const;

export function AvatarSides({ traits, head }: PartProps) {
  const left = AVATAR_CENTER - head.halfWidth - AVATAR_GAP;
  const right = AVATAR_CENTER + head.halfWidth + AVATAR_GAP;
  const fill = traits.colors.side;
  switch (traits.sides) {
    case "none":
      return null;
    case "block":
      return (
        <g fill={fill}>
          <rect x={left - 8.5} y={39} width={8.5} height={22} rx={4} />
          <rect x={right} y={39} width={8.5} height={22} rx={4} />
        </g>
      );
    case "round":
      return (
        <g fill={fill}>
          <path d={`M${left},40 A10,10 0 0 0 ${left},60 Z`} />
          <path d={`M${right},40 A10,10 0 0 1 ${right},60 Z`} />
        </g>
      );
    case "wings":
      return (
        <g fill={fill} stroke={fill} strokeWidth={3} strokeLinejoin="round">
          {SIDES.map((side) => (
            <path key={side} d={wingPath(head, side)} />
          ))}
        </g>
      );
  }
}

export function AvatarTop({ traits, head }: PartProps) {
  const { top } = head;
  const clear = top - AVATAR_GAP;
  const ornament = traits.colors.ornament;
  switch (traits.top) {
    case "none":
    case "cap":
      return null;
    case "antenna":
      return (
        <g fill={ornament}>
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
          {SIDES.map((side) => {
            const tipX = AVATAR_CENTER + side * 16;
            const tipY = top - 12;
            return (
              <g key={side}>
                <line
                  x1={AVATAR_CENTER + side * 9}
                  y1={clear - 1}
                  x2={tipX}
                  y2={tipY}
                  className={OUTSIDE_INK}
                  stroke="currentColor"
                  strokeWidth={STICK}
                  strokeLinecap="round"
                />
                <circle cx={tipX} cy={tipY} r={5.5} fill={ornament} />
              </g>
            );
          })}
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
          fill={ornament}
        />
      );
    case "bug-eyes":
      return (
        <g>
          {traits.bugEyes.map((bug, i) => {
            const [cx, cy] = bugEyeCenter(head, i, bug.r);
            return (
              <g key={i}>
                <circle cx={cx} cy={cy} r={bug.r} fill={ornament} />
                <Pupil cx={cx} cy={cy} r={bug.r} ratio={0.46} look={bug.look} />
              </g>
            );
          })}
        </g>
      );
  }
}

export function AvatarBottom({ traits, head }: PartProps) {
  const below = head.bottom + AVATAR_GAP;
  switch (traits.bottom) {
    case "none":
      return null;
    case "neck":
      return (
        <rect
          x={AVATAR_CENTER - 11}
          y={below}
          width={22}
          height={7}
          rx={3}
          {...(traits.colors.neck
            ? { fill: traits.colors.neck }
            : { className: OUTSIDE_INK, fill: "currentColor" })}
        />
      );
    case "stripes":
      return (
        <g fill={traits.colors.bottom}>
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
  const [bandTop, bandMiddle] = bandEdges(head);
  return (
    <>
      {traits.top === "cap" && (
        <path
          d={`M0,0 H100 V${cap} Q${AVATAR_CENTER},${cap + 7} 0,${cap} Z`}
          fill={traits.colors.cap}
        />
      )}
      {traits.banding === "chin" && (
        <path
          d={`M0,${chin} Q${AVATAR_CENTER},${chin - 5} 100,${chin} V100 H0 Z`}
          fill={traits.colors.chin}
        />
      )}
      {traits.banding === "bands" && (
        <rect
          x={0}
          y={bandTop}
          width={100}
          height={bandMiddle - bandTop}
          fill={traits.colors.band}
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
  const hasVisor = traits.face === "visor" || traits.face === "happy";
  return (
    <g fill="none" stroke="black" strokeWidth={AVATAR_GAP}>
      {traits.top === "cap" && <path d={capCurve(head)} />}
      {traits.banding === "chin" && <path d={chinCurve(head)} />}
      {traits.banding === "bands" &&
        bandEdges(head).map((y) => (
          <line key={y} x1={0} y1={y} x2={100} y2={y} />
        ))}
      {hasVisor && ring(visorBox(traits, head))}
    </g>
  );
}
