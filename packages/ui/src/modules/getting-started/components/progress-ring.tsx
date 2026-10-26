import { cn } from "@/lib/utils";

const R = 10;

function point(deg: number) {
  const rad = (deg * Math.PI) / 180;
  return `${14 + R * Math.cos(rad)} ${14 + R * Math.sin(rad)}`;
}

interface Props {
  done: number;
  total: number;
}

export function ProgressRing({ done, total }: Props) {
  const step = 360 / total;
  return (
    <svg viewBox="0 0 28 28" className="size-7 shrink-0" aria-hidden>
      {Array.from({ length: total }, (_, i) => {
        const start = -90 + i * step + 9;
        const end = start + step - 18;
        return (
          <path
            key={i}
            d={`M ${point(start)} A ${R} ${R} 0 0 1 ${point(end)}`}
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            className={cn(
              "transition-colors duration-500",
              i < done ? "stroke-primary" : "stroke-border",
            )}
          />
        );
      })}
    </svg>
  );
}
