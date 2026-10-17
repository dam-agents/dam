const AGENTS = Array.from({ length: 34 }, (_, i) => {
  const lane = i % 6;
  const step = Math.floor(i / 6);
  return {
    x: 238 + step * 26 + (lane % 2) * 13,
    y: 46 + lane * 20 + step * 9,
    r: 3 + ((i * 7) % 4),
    o: 0.35 + ((i * 13) % 6) / 10,
  };
});

export function DamGraphic({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 420 220" fill="none" aria-hidden className={className}>
      <defs>
        <linearGradient id="dam-water" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--color-accent)" stopOpacity="0.55" />
          <stop offset="1" stopColor="var(--color-accent)" stopOpacity="0.05" />
        </linearGradient>
        <linearGradient id="dam-spill" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="var(--color-accent)" stopOpacity="0.7" />
          <stop offset="1" stopColor="var(--color-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M0 70h196v150H0z" fill="url(#dam-water)" />
      {[78, 92, 106].map((y) => (
        <path
          key={y}
          d={`M8 ${y}q12-5 24 0t24 0 24 0 24 0 24 0 24 0 24 0`}
          stroke="var(--color-accent)"
          strokeOpacity="0.5"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      ))}
      <path
        d="M196 52h28l40 168h-68z"
        fill="var(--color-card)"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {[84, 116, 148, 180].map((y) => (
        <path
          key={y}
          d={`M196 ${y}h${28 + ((y - 52) * 40) / 168}`}
          stroke="currentColor"
          strokeOpacity="0.35"
          strokeWidth="1.5"
        />
      ))}
      <path
        d="M224 52c40 6 70 40 92 90s50 70 104 78v0H264z"
        fill="url(#dam-spill)"
        opacity="0.5"
      />
      {AGENTS.map((a, i) => (
        <circle
          key={i}
          cx={a.x}
          cy={a.y}
          r={a.r}
          fill="var(--color-accent)"
          opacity={a.o}
        />
      ))}
      <path d="M0 220h420" stroke="currentColor" strokeOpacity="0.3" />
    </svg>
  );
}
