import type { HeadGeometry } from "../../lib/avatar/geometry.js";
import {
  AVATAR_CENTER,
  faceCenterY,
  placeEyes,
  visorBox,
} from "../../lib/avatar/layout.js";
import {
  AVATAR_INK,
  AVATAR_SCLERA,
  type AvatarTraits,
  type Look,
} from "../../lib/avatar/traits.js";

interface PartProps {
  traits: AvatarTraits;
  head: HeadGeometry;
}

export function Pupil({
  cx,
  cy,
  r,
  ratio,
  look,
}: {
  cx: number;
  cy: number;
  r: number;
  ratio: number;
  look: Look;
}) {
  const pupil = r * ratio;
  const reach = r - pupil - r * 0.1;
  return (
    <circle
      cx={cx + look.dx * reach}
      cy={cy + look.dy * reach}
      r={pupil}
      fill={AVATAR_INK}
    />
  );
}

function Visor({ traits, head }: PartProps) {
  const box = visorBox(traits, head);
  const centerY = box.y + box.height / 2;
  const spread = box.width / 4;
  const dot = Math.min(5, box.height / 4);
  return (
    <>
      <rect {...box} fill={AVATAR_INK} />
      {traits.face === "happy" ? (
        <g
          fill="none"
          stroke={traits.colors.glow}
          strokeWidth={4.2}
          strokeLinecap="round"
        >
          {[-1, 1].map((side) => (
            <path
              key={side}
              d={`M${AVATAR_CENTER + side * spread - dot},${centerY + dot * 0.45} a${dot},${dot} 0 0 1 ${dot * 2},0`}
            />
          ))}
        </g>
      ) : (
        <g fill={traits.colors.glow}>
          {[-1, 1].map((side) => (
            <circle
              key={side}
              cx={AVATAR_CENTER + side * spread}
              cy={centerY}
              r={dot}
            />
          ))}
        </g>
      )}
    </>
  );
}

export function AvatarFace({ traits, head }: PartProps) {
  switch (traits.face) {
    case "blank":
      return null;
    case "eyes":
      return (
        <>
          {placeEyes(traits, head).map((spec, i) => (
            <g key={i}>
              <circle cx={spec.x} cy={spec.y} r={spec.r} fill={AVATAR_SCLERA} />
              <Pupil
                cx={spec.x}
                cy={spec.y}
                r={spec.r}
                ratio={spec.pupil}
                look={spec.look}
              />
            </g>
          ))}
        </>
      );
    case "visor":
    case "happy":
      return <Visor traits={traits} head={head} />;
    case "wink": {
      const y = faceCenterY(traits, head);
      const squeeze = Math.min(1, (head.halfWidth - 3) / 19);
      return (
        <g fill={AVATAR_INK}>
          <circle cx={AVATAR_CENTER - 12 * squeeze} cy={y} r={6} />
          <rect
            x={AVATAR_CENTER + 12 * squeeze - 7}
            y={y - 2.75}
            width={14}
            height={5.5}
            rx={2.75}
          />
        </g>
      );
    }
  }
}

export function AvatarMouth({ traits }: PartProps) {
  const y = 65;
  switch (traits.mouth) {
    case "none":
      return null;
    case "line":
      return (
        <rect
          x={AVATAR_CENTER - 8}
          y={y}
          width={16}
          height={5.5}
          rx={2.75}
          fill={AVATAR_INK}
        />
      );
    case "smile":
      return (
        <path
          d={`M${AVATAR_CENTER - 7},${y} Q${AVATAR_CENTER},${y + 7} ${AVATAR_CENTER + 7},${y}`}
          fill="none"
          stroke={AVATAR_INK}
          strokeWidth={4.5}
          strokeLinecap="round"
        />
      );
    case "o":
      return (
        <circle cx={AVATAR_CENTER} cy={y + 2.5} r={3.8} fill={AVATAR_INK} />
      );
  }
}
