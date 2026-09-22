import type { HeadGeometry } from "../../lib/avatar/geometry.js";
import {
  AVATAR_CENTER,
  capEdge,
  chinEdge,
  STRIPE_HEIGHT,
  STRIPE_INSET,
  STRIPE_ROWS,
  visorBox,
} from "../../lib/avatar/layout.js";
import {
  AVATAR_GAP,
  AVATAR_INK,
  AVATAR_SCLERA,
  type AvatarTraits,
} from "../../lib/avatar/traits.js";

interface PartProps {
  traits: AvatarTraits;
  head: HeadGeometry;
}

const OUTSIDE_INK = "text-[#1b2a4a] dark:text-[#aebbd3]";

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
            x={AVATAR_CENTER - 1.75}
            y={top - 12}
            width={3.5}
            height={12 - AVATAR_GAP}
            rx={1.75}
          />
          <circle cx={AVATAR_CENTER} cy={top - 14.5} r={5.5} />
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
            {[-1, 1].map((side) => (
              <line
                key={side}
                x1={AVATAR_CENTER + side * 9}
                y1={clear}
                x2={AVATAR_CENTER + side * 15}
                y2={top - 10}
              />
            ))}
          </g>
          <g fill={traits.accent}>
            {[-1, 1].map((side) => (
              <circle
                key={side}
                cx={AVATAR_CENTER + side * 16}
                cy={top - 13}
                r={4.5}
              />
            ))}
          </g>
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
    case "stalks":
      return (
        <g>
          <g
            stroke={traits.palette.light}
            strokeWidth={3}
            strokeLinecap="round"
          >
            {[-1, 1].map((side) => (
              <line
                key={side}
                x1={AVATAR_CENTER + side * 8}
                y1={clear}
                x2={AVATAR_CENTER + side * 15}
                y2={top - 8}
              />
            ))}
          </g>
          {traits.stalkLooks.map((look, i) => {
            const cx = AVATAR_CENTER + (i === 0 ? -18 : 18);
            const cy = top - 12;
            return (
              <g key={i}>
                <circle cx={cx} cy={cy} r={8} fill={traits.accent} />
                <circle cx={cx} cy={cy} r={5.4} fill={AVATAR_SCLERA} />
                <circle
                  cx={cx + look.dx * 2.2}
                  cy={cy + look.dy * 2.2}
                  r={2.6}
                  fill={AVATAR_INK}
                />
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
            height={4.5}
            rx={2.25}
          />
          <rect
            x={AVATAR_CENTER - 16}
            y={below + 4.5 + AVATAR_GAP}
            width={32}
            height={4.5}
            rx={2.25}
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
      {traits.face === "stripes" &&
        STRIPE_ROWS.flatMap((y) =>
          [y - AVATAR_GAP / 2, y + STRIPE_HEIGHT + AVATAR_GAP / 2].map(
            (edge) => (
              <line
                key={edge}
                x1={AVATAR_CENTER - head.halfWidth * STRIPE_INSET}
                y1={edge}
                x2={AVATAR_CENTER + head.halfWidth * STRIPE_INSET}
                y2={edge}
              />
            ),
          ),
        )}
    </g>
  );
}
