const R = 12;

function point(deg: number) {
  const rad = (deg * Math.PI) / 180;
  return `${16 + R * Math.cos(rad)} ${16 + R * Math.sin(rad)}`;
}

interface Props {
  done: number;
  total: number;
}

export function ProgressRing({ done, total }: Props) {
  const step = 360 / total;
  return (
    <svg
      viewBox="0 0 32 32"
      className="size-6 shrink-0"
      fill="none"
      stroke="currentColor"
      aria-hidden
    >
      {Array.from({ length: total }, (_, i) => {
        const start = -90 + i * step + 8;
        const end = start + step - 16;
        return (
          <path
            key={i}
            d={`M ${point(start)} A ${R} ${R} 0 0 1 ${point(end)}`}
            strokeWidth="2"
            strokeLinecap="round"
            className="transition-opacity duration-500"
            opacity={i < done ? 1 : 0.3}
          />
        );
      })}
      <g strokeWidth="1.75" strokeLinecap="round">
        <path d="M12.5 13.5v.5M19.5 13.5v.5" />
        <path d="M12 18.25a5 5 0 0 0 8 0" />
      </g>
    </svg>
  );
}
