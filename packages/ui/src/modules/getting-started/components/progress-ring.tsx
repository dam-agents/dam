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
      <g
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
        transform="rotate(-20 16 16.5)"
      >
        <path d="M12.6 17.2v-3.4a.8.8 0 0 1 1.6 0v2.4" />
        <path d="M14.2 16.2v-5.4a.8.8 0 0 1 1.6 0v5.2" />
        <path d="M15.8 16v-5.9a.8.8 0 0 1 1.6 0V16" />
        <path d="M17.4 16v-5.1a.8.8 0 0 1 1.6 0v6.6a3.6 3.6 0 0 1-3.6 3.6h-.3a3.4 3.4 0 0 1-2.9-1.6l-1.6-2.6a.8.8 0 0 1 1.3-.9l.7 1.2" />
      </g>
      <g strokeWidth="1.1" strokeLinecap="round">
        <path d="M20.6 9.4a3 3 0 0 1 1.6 2" />
        <path d="M11 21.8a3 3 0 0 1-1.7-1.6" />
      </g>
    </svg>
  );
}
