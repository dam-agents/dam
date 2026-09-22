import { BEE_TOP, beeBody, beeWing } from "../../lib/avatar/bee.js";
import { AVATAR_CENTER } from "../../lib/avatar/layout.js";
import {
  AVATAR_GAP,
  AVATAR_INK,
  type AvatarTraits,
} from "../../lib/avatar/traits.js";

const BODY = beeBody();
const WINGS = [beeWing(-1), beeWing(1)] as const;
const EYE_SPREAD = 9;

export function BeeFigure({ traits }: { traits: AvatarTraits }) {
  return (
    <g
      transform={`translate(${AVATAR_CENTER} 48) scale(1.1) translate(${-AVATAR_CENTER} -48)`}
    >
      <g
        fill={traits.wingColor}
        stroke={traits.wingColor}
        strokeWidth={3}
        strokeLinejoin="round"
      >
        {WINGS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <g fill={traits.palette.base}>
        <path d={BODY.topDome} />
        {BODY.bars.map((bar) => (
          <rect
            key={bar.y}
            x={AVATAR_CENTER - 15}
            y={bar.y}
            width={30}
            height={bar.height}
            rx={1.5}
          />
        ))}
        <path d={BODY.bottomDome} />
      </g>
      {traits.beeEyes.map((eye, i) => {
        const cx = AVATAR_CENTER + (i === 0 ? -EYE_SPREAD : EYE_SPREAD);
        const cy = BEE_TOP - AVATAR_GAP - eye.r;
        const pupil = eye.r * 0.46;
        const reach = eye.r - pupil - eye.r * 0.12;
        return (
          <g key={i}>
            <circle cx={cx} cy={cy} r={eye.r} fill={traits.accent} />
            <circle
              cx={cx + eye.look.dx * reach}
              cy={cy + eye.look.dy * reach}
              r={pupil}
              fill={AVATAR_INK}
            />
          </g>
        );
      })}
    </g>
  );
}
