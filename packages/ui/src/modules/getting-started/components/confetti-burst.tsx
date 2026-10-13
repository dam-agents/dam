import { type AvatarCharacter, avatarColors } from "api-server-api/avatar/svg";
import type { CSSProperties } from "react";

const PIECES = Array.from({ length: 14 }, (_, i) => ({
  angle: i * (360 / 14) + (i % 2 ? 9 : -6),
  distance: 58 + ((i * 7) % 22),
  spin: (i * 53) % 360,
  round: i % 3 === 0,
}));

interface Props {
  character: AvatarCharacter;
}

export function ConfettiBurst({ character }: Props) {
  const colors = avatarColors(character);
  return (
    <>
      {PIECES.map((p, i) => (
        <span
          key={i}
          className="absolute top-1/2 left-1/2"
          style={{ transform: `rotate(${p.angle}deg)` }}
        >
          <span
            className="block opacity-0 animate-[unlock-confetti_0.85s_cubic-bezier(0.2,0.8,0.3,1)_0.95s_forwards]"
            style={{ "--d": `${p.distance}px` } as CSSProperties}
          >
            <span
              className={
                p.round
                  ? "block size-2 rounded-full"
                  : "block h-1.5 w-3 rounded-sm"
              }
              style={{
                backgroundColor: colors[i % colors.length],
                transform: `translate(-50%, -50%) rotate(${p.spin}deg)`,
              }}
            />
          </span>
        </span>
      ))}
    </>
  );
}
