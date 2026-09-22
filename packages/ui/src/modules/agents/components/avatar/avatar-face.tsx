import type { HeadGeometry } from "../../lib/avatar/geometry.js";
import { AVATAR_CENTER, eyeScale, visorBox } from "../../lib/avatar/layout.js";
import {
  AVATAR_INK,
  AVATAR_SCLERA,
  type AvatarTraits,
  type EyeSpec,
} from "../../lib/avatar/traits.js";

interface PartProps {
  traits: AvatarTraits;
  head: HeadGeometry;
}

export function ScleraEye({
  cx,
  cy,
  r,
  pupil,
  look,
}: {
  cx: number;
  cy: number;
  r: number;
  pupil: number;
  look: EyeSpec["look"];
}) {
  const pupilRadius = r * pupil;
  const reach = r - pupilRadius - r * 0.1;
  return (
    <>
      <circle cx={cx} cy={cy} r={r} fill={AVATAR_SCLERA} />
      <circle
        cx={cx + look.dx * reach}
        cy={cy + look.dy * reach}
        r={pupilRadius}
        fill={AVATAR_INK}
      />
    </>
  );
}

function Visor({ traits, head }: PartProps) {
  const box = visorBox(head);
  const centerY = box.y + box.height / 2;
  const spread = box.width / 2 - 10.5;
  const glyph =
    traits.face === "happy" ? (
      <g
        fill="none"
        stroke={traits.palette.light}
        strokeWidth={4.2}
        strokeLinecap="round"
      >
        {[-1, 1].map((side) => (
          <path
            key={side}
            d={`M${AVATAR_CENTER + side * (spread - 1.5) - 5},${centerY + 2.2} a5,5 0 0 1 10,0`}
          />
        ))}
      </g>
    ) : (
      <g fill={traits.palette.light}>
        {[-1, 1].map((side) => (
          <circle
            key={side}
            cx={AVATAR_CENTER + side * spread}
            cy={centerY}
            r={5}
          />
        ))}
      </g>
    );
  return (
    <>
      <rect {...box} fill={AVATAR_INK} />
      {glyph}
    </>
  );
}

export function AvatarFace({ traits, head }: PartProps) {
  switch (traits.face) {
    case "eyes": {
      const scale = eyeScale(head);
      return (
        <>
          {traits.eyes.map((spec, i) => (
            <ScleraEye
              key={i}
              cx={AVATAR_CENTER + spec.x * scale}
              cy={spec.y}
              r={spec.r}
              pupil={spec.pupil}
              look={spec.look}
            />
          ))}
        </>
      );
    }
    case "visor":
    case "happy":
      return <Visor traits={traits} head={head} />;
    case "wink":
      return (
        <g fill={AVATAR_INK}>
          <circle cx={AVATAR_CENTER - 12} cy={48} r={6} />
          <rect x={AVATAR_CENTER + 5} y={45.5} width={14} height={5} rx={2.5} />
        </g>
      );
    case "bee":
      return null;
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
