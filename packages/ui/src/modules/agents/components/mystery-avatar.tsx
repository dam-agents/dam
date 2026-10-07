import { type CSSProperties, useId } from "react";

import { cn } from "@/lib/utils";

const EGG_D =
  "M20 3 C11.5 3 6 15 6 24 C6 31.5 12 37 20 37 C28 37 34 31.5 34 24 C34 15 28.5 3 20 3 Z";
const CRACK =
  "40,19 34,19 31,16.5 27.5,20.5 24,16.5 20.5,20.5 17,16.5 13.5,20.5 10,16.5 6,19 0,19";
const TOP_CLIP = `0,0 40,0 ${CRACK}`;
const BOTTOM_CLIP = `0,40 40,40 ${CRACK}`;
const SPECKLES: [number, number, number][] = [
  [15, 12.5, 1.4],
  [23.5, 9.5, 1.1],
  [26.5, 26, 1.6],
  [13, 28.5, 1.2],
  [20, 32, 0.9],
];

export const EGG_FILL = "#d6dbe0";
const SPECKLE_FILL = "#b3b9c0";

export function EggShape({
  part = "whole",
  className,
  style,
}: {
  part?: "whole" | "top" | "bottom";
  className?: string;
  style?: CSSProperties;
}) {
  const clipId = useId();
  const clip = part === "top" ? TOP_CLIP : BOTTOM_CLIP;
  return (
    <svg
      viewBox="0 0 40 40"
      aria-hidden
      className={cn("shrink-0", className)}
      style={style}
    >
      {part !== "whole" && (
        <defs>
          <clipPath id={clipId}>
            <polygon points={clip} />
          </clipPath>
        </defs>
      )}
      <g clipPath={part === "whole" ? undefined : `url(#${clipId})`}>
        <path d={EGG_D} fill={EGG_FILL} />
        {SPECKLES.map(([cx, cy, r]) => (
          <circle
            key={`${cx}-${cy}`}
            cx={cx}
            cy={cy}
            r={r}
            fill={SPECKLE_FILL}
          />
        ))}
      </g>
    </svg>
  );
}

export function MysteryAvatar({ className }: { className?: string }) {
  return <EggShape className={className} />;
}
