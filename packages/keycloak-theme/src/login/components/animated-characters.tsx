import { useEffect, useRef, useState } from "react";

const PINK = "#E89DA8";
const BLUE = "#5B76D2";
const GREEN = "#3F6C45";
const TERRACOTTA = "#CA6040";
const ORANGE = "#DE9950";

/* ── Character SVGs (from the design-session-3 avatar system) ──────── */

function CompassEyes({ blink }: { blink: boolean }) {
  if (blink) {
    return (
      <>
        <path
          d="M66.80,62.52 A8.94,8.94 0 0 0 84.68,62.52"
          fill="none"
          stroke={PINK}
          strokeWidth="5.74"
        />
        <path
          d="M40.30,62.52 A8.94,8.94 0 0 0 58.19,62.52"
          fill="none"
          stroke={PINK}
          strokeWidth="5.74"
        />
      </>
    );
  }
  return (
    <>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M75.74 53.57C70.80 53.57 66.80 57.58 66.80 62.52C66.80 67.46 70.80 71.46 75.74 71.46C80.68 71.46 84.68 67.46 84.68 62.52C84.68 57.58 80.68 53.57 75.74 53.57Z"
        fill={PINK}
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M49.25 53.57C44.31 53.57 40.30 57.58 40.30 62.52C40.30 67.46 44.31 71.46 49.25 71.46C54.19 71.46 58.19 67.46 58.19 62.52C58.19 57.58 54.19 53.57 49.25 53.57Z"
        fill={PINK}
      />
    </>
  );
}

function CompassBody() {
  return (
    <>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M88.32 85.79L108.71 67.84L108.72 95.73C108.63 100.73 106.21 106.37 99.75 108.40C93.04 110.52 85.81 106.77 83.69 100.05C81.90 94.36 84.20 89.45 88.32 85.79Z"
        fill={GREEN}
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M88.32 39.20L108.71 57.14L108.72 29.25C108.63 24.26 106.21 18.62 99.75 16.58C93.04 14.47 85.81 18.22 83.69 24.93C81.90 30.62 84.20 35.53 88.32 39.20Z"
        fill={GREEN}
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M36.43 39.20L16.04 57.14L16.03 29.25C16.12 24.26 18.54 18.62 24.99 16.58C31.71 14.47 38.94 18.22 41.06 24.93C42.85 30.62 40.55 35.53 36.43 39.20Z"
        fill={GREEN}
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M36.43 85.79L16.04 67.84L16.03 95.73C16.12 100.73 18.54 106.37 24.99 108.40C31.71 110.52 38.94 106.77 41.06 100.05C42.85 94.36 40.55 89.45 36.43 85.79Z"
        fill={GREEN}
      />
    </>
  );
}

function SparkEyes({ blink }: { blink: boolean }) {
  if (blink) {
    return (
      <>
        <path
          d="M1845,680 A249,249 0 0 0 2343,680"
          fill="none"
          stroke={PINK}
          strokeWidth="160"
        />
        <path
          d="M1142,680 A249,249 0 0 0 1640,680"
          fill="none"
          stroke={PINK}
          strokeWidth="160"
        />
      </>
    );
  }
  return (
    <>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M2094 431C1956.3 431 1844.6 542.7 1844.6 680.5C1844.6 818.3 1956.3 930 2094 930C2231.8 930 2343.4 818.3 2343.4 680.5C2343.4 542.7 2231.8 431 2094 431Z"
        fill={PINK}
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M1391 431C1253.3 431 1141.6 542.7 1141.6 680.5C1141.6 818.3 1253.3 930 1391 930C1528.8 930 1640.4 818.3 1640.4 680.5C1640.4 542.7 1528.8 431 1391 431Z"
        fill={PINK}
      />
    </>
  );
}

function SparkBody() {
  return (
    <>
      <circle cx="1743" cy="1858" r="611" fill={TERRACOTTA} />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M750 1238C750 1238 750 1858 750 1858C750 2200.3 466.1 2478 130 2478L130 1238C466.1 1238 750 1238 750 1238Z"
        fill={GREEN}
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M2736 1238C2736 1238 2736 1858 2736 1858C2736 2200.3 3019.9 2478 3356 2478L3356 1238C3019.9 1238 2736 1238 2736 1238Z"
        fill={GREEN}
      />
    </>
  );
}

function RollerEyes({ blink }: { blink: boolean }) {
  if (blink) {
    return (
      <>
        <path
          d="M1843,717 A249,249 0 0 0 2342,717"
          fill="none"
          stroke={PINK}
          strokeWidth="160"
        />
        <path
          d="M1140,717 A249,249 0 0 0 1639,717"
          fill="none"
          stroke={PINK}
          strokeWidth="160"
        />
      </>
    );
  }
  return (
    <>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M2092 467C1954.5 467 1843 578.7 1843 716.5C1843 854.3 1954.5 966 2092 966C2230 966 2342 854.3 2342 716.5C2342 578.7 2230 467 2092 467Z"
        fill={PINK}
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M1389 467C1251.7 467 1140 578.7 1140 716.5C1140 854.3 1251.7 966 1389 966C1527.2 966 1639 854.3 1639 716.5C1639 578.7 1527.2 467 1389 467Z"
        fill={PINK}
      />
    </>
  );
}

function RollerBody() {
  return (
    <>
      <rect x="933" y="1189" width="1616" height="489" fill={BLUE} />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M933 1901C1075.5 2205.2 1384.3 2417 1741.9 2417C2099.8 2417 2406.6 2205.5 2549 1901H933Z"
        fill={ORANGE}
      />
      <circle cx="1046" cy="2790" r="249" fill="#000" />
      <circle cx="2439" cy="2790" r="249" fill="#000" />
    </>
  );
}

function WaveEyes({ blink }: { blink: boolean }) {
  if (blink) {
    return (
      <>
        <path
          d="M1845,1542 A249,249 0 0 0 2344,1542"
          fill="none"
          stroke={PINK}
          strokeWidth="160"
        />
        <path
          d="M1142,1542 A249,249 0 0 0 1641,1542"
          fill="none"
          stroke={PINK}
          strokeWidth="160"
        />
      </>
    );
  }
  return (
    <>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M2094 1292C1956.5 1292 1845 1403.7 1845 1541.5C1845 1679.3 1956.5 1791 2094 1791C2232 1791 2344 1679.3 2344 1541.5C2344 1403.7 2232 1292 2094 1292Z"
        fill={PINK}
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M1391 1292C1253.7 1292 1142 1403.7 1142 1541.5C1142 1679.3 1253.7 1791 1391 1791C1529.2 1791 1641 1679.3 1641 1541.5C1641 1403.7 1529.2 1292 1391 1292Z"
        fill={PINK}
      />
    </>
  );
}

function WaveBody() {
  return (
    <>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M1743 552C1279.5 552 875.2 799.7 655 1178.8V1389.9C918 1088.2 1307.4 895.4 1743 895.4C2178.6 895.4 2568 1088.2 2831 1389.9V1178.8C2610.8 799.7 2206.5 552 1743 552Z"
        fill={TERRACOTTA}
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M1743 2934C1279.5 2934 875.2 2686.3 655 2307.2V2096.1C918 2397.8 1307.4 2590.6 1743 2590.6C2178.6 2590.6 2568 2397.8 2831 2096.1V2307.2C2610.8 2686.3 2206.5 2934 1743 2934Z"
        fill={TERRACOTTA}
      />
    </>
  );
}

function ShieldEyes({ blink }: { blink: boolean }) {
  if (blink) {
    return (
      <>
        <path d="M1844.84,1425.5 A249.42,249.42 0 0 0 2343.67,1425.5" fill="none" stroke={PINK} strokeWidth="160" />
        <path d="M1142,1425.5 A249.42,249.42 0 0 0 1640.84,1425.5" fill="none" stroke={PINK} strokeWidth="160" />
      </>
    );
  }
  return (
    <>
      <path fillRule="evenodd" clipRule="evenodd" d="M2094.25 1176C1956.52 1176 1844.84 1287.7 1844.84 1425.5C1844.84 1563.3 1956.52 1675 2094.25 1675C2232 1675 2343.67 1563.3 2343.67 1425.5C2343.67 1287.7 2232 1176 2094.25 1176Z" fill={PINK} />
      <path fillRule="evenodd" clipRule="evenodd" d="M1391.43 1176C1253.67 1176 1142 1287.7 1142 1425.5C1142 1563.3 1253.67 1675 1391.43 1675C1529.18 1675 1640.84 1563.3 1640.84 1425.5C1640.84 1287.7 1529.18 1176 1391.43 1176Z" fill={PINK} />
    </>
  );
}

function ShieldBody() {
  return (
    <>
      <rect x="1189" y="1898" width="1126" height="489" fill={BLUE} />
      <path fillRule="evenodd" clipRule="evenodd" d="M966 2551C661.827 2408.46 450 2099.72 450 1742.07C450 1384.17 661.492 1077.41 966 935L966 2551Z" fill={ORANGE} />
      <path fillRule="evenodd" clipRule="evenodd" d="M2538 2551C2842.17 2408.46 3054 2099.72 3054 1742.07C3054 1384.17 2842.51 1077.41 2538 935V2551Z" fill={ORANGE} />
    </>
  );
}

function StackEyes({ blink }: { blink: boolean }) {
  if (blink) {
    return (
      <>
        <path d="M1844.84,696.5 A249.42,249.42 0 0 0 2343.67,696.5" fill="none" stroke={PINK} strokeWidth="160" />
        <path d="M1142,696.5 A249.42,249.42 0 0 0 1640.84,696.5" fill="none" stroke={PINK} strokeWidth="160" />
      </>
    );
  }
  return (
    <>
      <path fillRule="evenodd" clipRule="evenodd" d="M2094.25 447C1956.52 447 1844.84 558.7 1844.84 696.5C1844.84 834.3 1956.52 946 2094.25 946C2232 946 2343.67 834.3 2343.67 696.5C2343.67 558.7 2232 447 2094.25 447Z" fill={PINK} />
      <path fillRule="evenodd" clipRule="evenodd" d="M1391.43 447C1253.67 447 1142 558.7 1142 696.5C1142 834.3 1253.67 946 1391.43 946C1529.18 946 1640.84 834.3 1640.84 696.5C1640.84 558.7 1529.18 447 1391.43 447Z" fill={PINK} />
    </>
  );
}

function StackBody() {
  return (
    <>
      <rect x="935" y="1125" width="1616" height="489.42" fill={BLUE} />
      <rect x="935" y="1837.52" width="1616" height="489.41" fill={BLUE} />
      <rect x="935" y="2550.04" width="1616" height="489.41" fill={BLUE} />
    </>
  );
}

function TowerEyes({ blink }: { blink: boolean }) {
  if (blink) {
    return (
      <>
        <path d="M1844.84,1743.5 A249.42,249.42 0 0 0 2343.67,1743.5" fill="none" stroke={PINK} strokeWidth="160" />
        <path d="M1142,1743.5 A249.42,249.42 0 0 0 1640.84,1743.5" fill="none" stroke={PINK} strokeWidth="160" />
      </>
    );
  }
  return (
    <>
      <path fillRule="evenodd" clipRule="evenodd" d="M2094.25 1494C1956.52 1494 1844.84 1605.7 1844.84 1743.5C1844.84 1881.3 1956.52 1993 2094.25 1993C2232 1993 2343.67 1881.3 2343.67 1743.5C2343.67 1605.7 2232 1494 2094.25 1494Z" fill={PINK} />
      <path fillRule="evenodd" clipRule="evenodd" d="M1391.43 1494C1253.67 1494 1142 1605.7 1142 1743.5C1142 1881.3 1253.67 1993 1391.43 1993C1529.18 1993 1640.84 1881.3 1640.84 1743.5C1640.84 1605.7 1529.18 1494 1391.43 1494Z" fill={PINK} />
    </>
  );
}

function TowerBody() {
  return (
    <>
      <rect x="2550" y="936" width="489" height="1616" fill={BLUE} />
      <rect x="446" y="935" width="489.417" height="1616" fill={BLUE} />
    </>
  );
}

function LensEyes({ blink }: { blink: boolean }) {
  if (blink) {
    return (
      <>
        <path d="M760,900 A340,340 0 0 0 1440,900" fill="none" stroke={PINK} strokeWidth="160" />
        <path d="M1620,700 A280,280 0 0 0 2180,700" fill="none" stroke={PINK} strokeWidth="160" />
        <path d="M2190,1150 A310,310 0 0 0 2810,1150" fill="none" stroke={PINK} strokeWidth="160" />
        <path d="M400,1700 A300,300 0 0 0 1000,1700" fill="none" stroke={PINK} strokeWidth="160" />
        <path d="M1270,1650 A380,380 0 0 0 2030,1650" fill="none" stroke={PINK} strokeWidth="160" />
        <path d="M2090,2100 A260,260 0 0 0 2610,2100" fill="none" stroke={PINK} strokeWidth="160" />
        <path d="M880,2500 A320,320 0 0 0 1520,2500" fill="none" stroke={PINK} strokeWidth="160" />
      </>
    );
  }
  return (
    <>
      <path fillRule="evenodd" clipRule="evenodd" d="M1100 560C912.32 560 760 712.32 760 900C760 1087.68 912.32 1240 1100 1240C1287.68 1240 1440 1087.68 1440 900C1440 712.32 1287.68 560 1100 560Z" fill={PINK} />
      <path fillRule="evenodd" clipRule="evenodd" d="M1900 420C1745.44 420 1620 545.44 1620 700C1620 854.56 1745.44 980 1900 980C2054.56 980 2180 854.56 2180 700C2180 545.44 2054.56 420 1900 420Z" fill={PINK} />
      <path fillRule="evenodd" clipRule="evenodd" d="M2500 840C2328.88 840 2190 978.88 2190 1150C2190 1321.12 2328.88 1460 2500 1460C2671.12 1460 2810 1321.12 2810 1150C2810 978.88 2671.12 840 2500 840Z" fill={PINK} />
      <path fillRule="evenodd" clipRule="evenodd" d="M700 1400C534.4 1400 400 1534.4 400 1700C400 1865.6 534.4 2000 700 2000C865.6 2000 1000 1865.6 1000 1700C1000 1534.4 865.6 1400 700 1400Z" fill={PINK} />
      <path fillRule="evenodd" clipRule="evenodd" d="M1650 1270C1440.24 1270 1270 1440.24 1270 1650C1270 1859.76 1440.24 2030 1650 2030C1859.76 2030 2030 1859.76 2030 1650C2030 1440.24 1859.76 1270 1650 1270Z" fill={PINK} />
      <path fillRule="evenodd" clipRule="evenodd" d="M2350 1840C2206.48 1840 2090 1956.48 2090 2100C2090 2243.52 2206.48 2360 2350 2360C2493.52 2360 2610 2243.52 2610 2100C2610 1956.48 2493.52 1840 2350 1840Z" fill={PINK} />
      <path fillRule="evenodd" clipRule="evenodd" d="M1200 2180C1023.36 2180 880 2323.36 880 2500C880 2676.64 1023.36 2820 1200 2820C1376.64 2820 1520 2676.64 1520 2500C1520 2323.36 1376.64 2180 1200 2180Z" fill={PINK} />
    </>
  );
}

/* ── Blink hook ─────────────────────────────────────────────────────── */

function useBlinkCycle(intervalMin = 2500, intervalMax = 5000) {
  const [blink, setBlink] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    function schedule() {
      const wait =
        intervalMin + Math.random() * (intervalMax - intervalMin);
      timeout.current = setTimeout(() => {
        setBlink(true);
        setTimeout(() => {
          setBlink(false);
          schedule();
        }, 150);
      }, wait);
    }
    schedule();
    return () => clearTimeout(timeout.current);
  }, [intervalMin, intervalMax]);

  return blink;
}

/* ── Shared character catalogue ────────────────────────────────────── */

const CHARACTER_NAMES = [
  "compass",
  "spark",
  "roller",
  "wave",
  "shield",
  "stack",
  "tower",
  "lens",
] as const;
type CharacterName = (typeof CHARACTER_NAMES)[number];

function CharacterSvg({
  name,
  blink,
}: {
  name: CharacterName;
  blink: boolean;
}) {
  switch (name) {
    case "compass":
      return (
        <svg viewBox="0 0 125 125" fill="none">
          <CompassEyes blink={blink} />
          <CompassBody />
        </svg>
      );
    case "spark":
      return (
        <svg viewBox="0 0 3486 3486" fill="none">
          <SparkEyes blink={blink} />
          <SparkBody />
        </svg>
      );
    case "roller":
      return (
        <svg viewBox="0 0 3486 3486" fill="none">
          <RollerEyes blink={blink} />
          <RollerBody />
        </svg>
      );
    case "wave":
      return (
        <svg viewBox="0 0 3486 3486" fill="none">
          <WaveEyes blink={blink} />
          <WaveBody />
        </svg>
      );
    case "shield":
      return (
        <svg viewBox="0 0 3486 3486" fill="none">
          <ShieldEyes blink={blink} />
          <ShieldBody />
        </svg>
      );
    case "stack":
      return (
        <svg viewBox="0 0 3486 3486" fill="none">
          <StackEyes blink={blink} />
          <StackBody />
        </svg>
      );
    case "tower":
      return (
        <svg viewBox="0 0 3486 3486" fill="none">
          <TowerEyes blink={blink} />
          <TowerBody />
        </svg>
      );
    case "lens":
      return (
        <svg viewBox="0 0 3486 3486" fill="none">
          <LensEyes blink={blink} />
        </svg>
      );
  }
}

/* ── Hero: 10 switchable character concepts ──────────────────────── */

const HERO_KEYFRAMES = `
@keyframes hero-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-14px); }
}
@keyframes hero-float-sm {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}
@keyframes hero-wobble {
  0%, 100% { transform: rotate(-2deg); }
  50% { transform: rotate(2deg); }
}
@keyframes hero-pulse {
  0%, 100% { opacity: 0.3; transform: scale(1); }
  50% { opacity: 0.7; transform: scale(1.15); }
}
@keyframes hero-twinkle {
  0%, 20% { opacity: 0.15; }
  10% { opacity: 0.9; }
}
@keyframes hero-rise {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-24px); }
}
@keyframes hero-bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-5px); }
}
`;

let heroStylesInjected = false;
function injectHeroStyles() {
  if (heroStylesInjected) return;
  heroStylesInjected = true;
  const el = document.createElement("style");
  el.textContent = HERO_KEYFRAMES;
  document.head.appendChild(el);
}

interface VariantProps {
  blinks: boolean[];
}

function Char({
  name,
  blink,
  x,
  y,
  size,
  style,
}: {
  name: CharacterName;
  blink: boolean;
  x: number;
  y: number;
  size: number;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className="absolute"
      style={{
        left: x,
        top: y,
        width: size,
        height: size,
        filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.08))",
        ...style,
      }}
    >
      <CharacterSvg name={name} blink={blink} />
    </div>
  );
}

function Dot({
  x,
  y,
  size,
  color,
  anim,
}: {
  x: number;
  y: number;
  size: number;
  color?: string;
  anim?: string;
}) {
  return (
    <div
      className="absolute rounded-full"
      style={{
        left: x,
        top: y,
        width: size,
        height: size,
        background: color || "var(--muted)",
        animation: anim,
      }}
    />
  );
}

/* V1 — Huddle: characters in a semicircle with speech dots */
function HeroHuddle({ blinks }: VariantProps) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="relative" style={{ width: 440, height: 340 }}>
        <Char name="compass" blink={blinks[0]} x={20} y={90} size={120}
          style={{ animation: "hero-float 6s ease-in-out infinite" }} />
        <Dot x={70} y={70} size={10} anim="hero-pulse 3s ease-in-out infinite 0.2s" />
        <Dot x={55} y={55} size={7} anim="hero-pulse 3.5s ease-in-out infinite 0.8s" />

        <Char name="spark" blink={blinks[1]} x={150} y={30} size={140}
          style={{ animation: "hero-float 7s ease-in-out infinite 0.8s" }} />
        <Dot x={210} y={8} size={14} anim="hero-pulse 4s ease-in-out infinite 0.5s" />
        <Dot x={228} y={20} size={8} anim="hero-pulse 3s ease-in-out infinite 1.2s" />

        <Char name="shield" blink={blinks[2]} x={300} y={70} size={120}
          style={{ animation: "hero-float 5.5s ease-in-out infinite 0.4s" }} />
        <Dot x={352} y={50} size={12} anim="hero-pulse 3.5s ease-in-out infinite 0.3s" />

        <Char name="wave" blink={blinks[3]} x={180} y={200} size={100}
          style={{ animation: "hero-float 6.5s ease-in-out infinite 1.2s" }} />
        <Dot x={222} y={184} size={9} anim="hero-pulse 3s ease-in-out infinite 0.7s" />
        <Dot x={236} y={176} size={6} anim="hero-pulse 4s ease-in-out infinite 1s" />
      </div>
    </div>
  );
}

/* V2 — Pipeline: assembly line with arrows */
function HeroPipeline({ blinks }: VariantProps) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="relative" style={{ width: 480, height: 200 }}>
        <Char name="roller" blink={blinks[0]} x={0} y={40} size={120}
          style={{ animation: "hero-float-sm 5s ease-in-out infinite" }} />
        <svg className="absolute" style={{ left: 130, top: 80, width: 50, height: 40 }} viewBox="0 0 50 40" fill="none">
          <path d="M5 20h30m0 0l-8-8m8 8l-8 8" stroke="var(--muted-foreground)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />
        </svg>
        <Char name="stack" blink={blinks[1]} x={180} y={30} size={130}
          style={{ animation: "hero-float-sm 6s ease-in-out infinite 0.5s" }} />
        <svg className="absolute" style={{ left: 320, top: 80, width: 50, height: 40 }} viewBox="0 0 50 40" fill="none">
          <path d="M5 20h30m0 0l-8-8m8 8l-8 8" stroke="var(--muted-foreground)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />
        </svg>
        <Char name="compass" blink={blinks[2]} x={370} y={45} size={110}
          style={{ animation: "hero-float-sm 5.5s ease-in-out infinite 1s" }} />
        <div className="absolute text-center" style={{ left: 20, top: 168, width: 80, fontSize: 14, color: "var(--muted-foreground)", opacity: 0.6 }}>receive</div>
        <div className="absolute text-center" style={{ left: 210, top: 168, width: 80, fontSize: 14, color: "var(--muted-foreground)", opacity: 0.6 }}>process</div>
        <div className="absolute text-center" style={{ left: 385, top: 168, width: 80, fontSize: 14, color: "var(--muted-foreground)", opacity: 0.6 }}>deploy</div>
      </div>
    </div>
  );
}

/* V3 — Totem: characters stacked as a wobbling tower */
function HeroTotem({ blinks }: VariantProps) {
  return (
    <div className="flex h-full items-end justify-center pb-8">
      <div className="relative" style={{ width: 160, height: 420, animation: "hero-wobble 8s ease-in-out infinite" }}>
        <Char name="stack" blink={blinks[0]} x={10} y={280} size={140} />
        <Char name="roller" blink={blinks[1]} x={20} y={180} size={120}
          style={{ transform: "rotate(3deg)" }} />
        <Char name="spark" blink={blinks[2]} x={5} y={70} size={130}
          style={{ transform: "rotate(-4deg)" }} />
        <Char name="compass" blink={blinks[3]} x={30} y={0} size={100}
          style={{ transform: "rotate(6deg)" }} />
      </div>
    </div>
  );
}

/* V4 — Night Shift: characters working inside a monitor */
function HeroNightShift({ blinks }: VariantProps) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="relative" style={{ width: 440, height: 340 }}>
        <div className="absolute rounded-2xl" style={{ left: 20, top: 20, width: 400, height: 260, background: "#1a1a2e", border: "2px solid #2a2a4a" }}>
          {[40, 70, 100, 130].map((top, i) => (
            <div key={i} className="absolute rounded" style={{
              left: 24, top, height: 6,
              width: [140, 200, 100, 160][i],
              background: ["#3a6", "#78a9ff", "#666", "#3a6"][i],
              opacity: 0.3,
            }} />
          ))}
          <Char name="shield" blink={blinks[0]} x={240} y={40} size={90}
            style={{ animation: "hero-float-sm 6s ease-in-out infinite", opacity: 0.9 }} />
          <Char name="lens" blink={blinks[1]} x={300} y={120} size={80}
            style={{ animation: "hero-float-sm 5s ease-in-out infinite 0.5s", opacity: 0.9 }} />
        </div>
        <div className="absolute" style={{ left: 190, top: 280, width: 60, height: 20, background: "#2a2a4a", borderRadius: 4 }} />
        <div className="absolute" style={{ left: 170, top: 296, width: 100, height: 8, background: "#2a2a4a", borderRadius: 4 }} />
        {[
          { x: 8, y: 0, s: 4, d: 0 }, { x: 430, y: 10, s: 5, d: 1 },
          { x: 410, y: 80, s: 3, d: 2 }, { x: 0, y: 140, s: 4, d: 0.5 },
          { x: 440, y: 180, s: 3, d: 1.5 }, { x: 10, y: 260, s: 5, d: 0.8 },
        ].map(({ x, y, s, d }, i) => (
          <Dot key={i} x={x} y={y} size={s} color="#78a9ff"
            anim={`hero-twinkle ${3 + d}s ease-in-out infinite ${d}s`} />
        ))}
        <svg className="absolute" style={{ left: 420, top: 40, width: 30, height: 30 }} viewBox="0 0 30 30" fill="none">
          <circle cx="15" cy="15" r="12" fill="#f0e68c" opacity="0.3" />
          <circle cx="20" cy="12" r="10" fill="var(--background)" />
        </svg>
      </div>
    </div>
  );
}

/* V5 — Blast Off: one character launching, others watching */
function HeroBlastOff({ blinks }: VariantProps) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="relative" style={{ width: 400, height: 400 }}>
        <Char name="spark" blink={blinks[0]} x={155} y={20} size={120}
          style={{ animation: "hero-rise 4s ease-in-out infinite" }} />
        <svg className="absolute" style={{ left: 175, top: 140, width: 80, height: 120 }} viewBox="0 0 80 120" fill="none">
          <line x1="20" y1="0" x2="20" y2="120" stroke={TERRACOTTA} strokeWidth="3" strokeDasharray="8 8" opacity="0.4" />
          <line x1="40" y1="10" x2="40" y2="110" stroke={ORANGE} strokeWidth="2" strokeDasharray="6 10" opacity="0.3" />
          <line x1="60" y1="5" x2="60" y2="115" stroke={TERRACOTTA} strokeWidth="3" strokeDasharray="8 8" opacity="0.4" />
        </svg>
        <Char name="compass" blink={blinks[1]} x={40} y={280} size={100}
          style={{ transform: "rotate(-8deg)" }} />
        <Char name="wave" blink={blinks[2]} x={160} y={300} size={80}
          style={{ transform: "rotate(5deg)" }} />
        <Char name="roller" blink={blinks[3]} x={270} y={270} size={90}
          style={{ transform: "rotate(3deg)" }} />
        <div className="absolute" style={{ left: 20, top: 370, width: 360, height: 2, background: "var(--muted)", borderRadius: 1 }} />
      </div>
    </div>
  );
}

/* V6 — Parade: diagonal march with confetti */
function HeroParade({ blinks }: VariantProps) {
  const confetti = [PINK, BLUE, GREEN, TERRACOTTA, ORANGE];
  return (
    <div className="flex h-full items-center justify-center">
      <div className="relative" style={{ width: 500, height: 340 }}>
        <Char name="compass" blink={blinks[0]} x={20} y={200} size={110}
          style={{ transform: "rotate(-8deg)", animation: "hero-bounce 2s ease-in-out infinite" }} />
        <Char name="spark" blink={blinks[1]} x={140} y={140} size={130}
          style={{ transform: "rotate(5deg)", animation: "hero-bounce 2s ease-in-out infinite 0.3s" }} />
        <Char name="roller" blink={blinks[2]} x={280} y={90} size={100}
          style={{ transform: "rotate(-3deg)", animation: "hero-bounce 2s ease-in-out infinite 0.6s" }} />
        <Char name="shield" blink={blinks[3]} x={380} y={40} size={120}
          style={{ transform: "rotate(6deg)", animation: "hero-bounce 2s ease-in-out infinite 0.9s" }} />
        {[
          { x: 60, y: 20, s: 8 }, { x: 180, y: 40, s: 6 }, { x: 300, y: 15, s: 10 },
          { x: 420, y: 30, s: 7 }, { x: 100, y: 80, s: 5 }, { x: 350, y: 60, s: 8 },
          { x: 470, y: 120, s: 6 }, { x: 50, y: 160, s: 7 }, { x: 250, y: 50, s: 5 },
          { x: 440, y: 180, s: 9 }, { x: 120, y: 30, s: 6 }, { x: 330, y: 130, s: 5 },
        ].map(({ x, y, s }, i) => (
          <Dot key={i} x={x} y={y} size={s}
            color={confetti[i % confetti.length]}
            anim={`hero-twinkle ${2 + (i % 3)}s ease-in-out infinite ${i * 0.2}s`} />
        ))}
      </div>
    </div>
  );
}

/* V7 — Terrarium: characters inside a glass dome */
function HeroTerrarium({ blinks }: VariantProps) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="relative" style={{ width: 360, height: 380 }}>
        <svg className="absolute inset-0" viewBox="0 0 360 380" fill="none">
          <path d="M40 300 Q40 40 180 40 Q320 40 320 300" stroke="var(--input)" strokeWidth="3" fill="none" opacity="0.5" />
          <rect x="30" y="296" width="300" height="16" rx="4" fill="var(--muted)" />
          <path d="M90 280 Q90 80 180 60" stroke="var(--input)" strokeWidth="1.5" fill="none" opacity="0.2" />
        </svg>
        <Char name="compass" blink={blinks[0]} x={60} y={160} size={100}
          style={{ animation: "hero-float-sm 7s ease-in-out infinite" }} />
        <Char name="spark" blink={blinks[1]} x={140} y={110} size={110}
          style={{ animation: "hero-float-sm 6s ease-in-out infinite 0.5s" }} />
        <Char name="lens" blink={blinks[2]} x={220} y={170} size={90}
          style={{ animation: "hero-float-sm 8s ease-in-out infinite 1s" }} />
        {[
          { x: 120, y: 80, s: 4 }, { x: 200, y: 100, s: 3 },
          { x: 160, y: 60, s: 5 }, { x: 260, y: 140, s: 3 }, { x: 90, y: 130, s: 4 },
        ].map(({ x, y, s }, i) => (
          <Dot key={i} x={x} y={y} size={s} color="var(--muted-foreground)"
            anim={`hero-pulse ${3 + i * 0.5}s ease-in-out infinite ${i * 0.4}s`} />
        ))}
      </div>
    </div>
  );
}

/* V8 — Hide & Seek: characters peeking from behind a 2x2 grid */
function HeroGrid({ blinks }: VariantProps) {
  const box = 140;
  const gap = 24;
  const total = box * 2 + gap;
  return (
    <div className="flex h-full items-center justify-center">
      <div className="relative" style={{ width: total, height: total }}>
        <Char name="compass" blink={blinks[0]} x={box - 30} y={-30} size={80}
          style={{ zIndex: 0, animation: "hero-float-sm 5s ease-in-out infinite" }} />
        <Char name="spark" blink={blinks[1]} x={box + gap - 20} y={box - 40} size={80}
          style={{ zIndex: 0, animation: "hero-float-sm 6s ease-in-out infinite 0.3s" }} />
        <Char name="roller" blink={blinks[2]} x={30} y={box + gap - 30} size={80}
          style={{ zIndex: 0, animation: "hero-float-sm 7s ease-in-out infinite 0.6s" }} />
        <Char name="shield" blink={blinks[3]} x={box + gap + 50} y={box + gap + box - 40} size={80}
          style={{ zIndex: 0, animation: "hero-float-sm 5.5s ease-in-out infinite 0.9s" }} />
        <div className="absolute rounded-2xl bg-muted" style={{ left: 0, top: 0, width: box, height: box, zIndex: 1, opacity: 0.6 }} />
        <div className="absolute rounded-2xl bg-muted" style={{ left: box + gap, top: 0, width: box, height: box, zIndex: 1, opacity: 0.6 }} />
        <div className="absolute rounded-2xl bg-muted" style={{ left: 0, top: box + gap, width: box, height: box, zIndex: 1, opacity: 0.6 }} />
        <div className="absolute rounded-2xl bg-muted" style={{ left: box + gap, top: box + gap, width: box, height: box, zIndex: 1, opacity: 0.6 }} />
      </div>
    </div>
  );
}

/* V9 — Constellation: characters as stars connected by dotted lines */
function HeroConstellation({ blinks }: VariantProps) {
  const nodes = [
    { name: "compass" as CharacterName, x: 60, y: 80, size: 70 },
    { name: "spark" as CharacterName, x: 220, y: 30, size: 80 },
    { name: "roller" as CharacterName, x: 350, y: 100, size: 65 },
    { name: "wave" as CharacterName, x: 140, y: 230, size: 60 },
    { name: "shield" as CharacterName, x: 300, y: 220, size: 75 },
  ];
  const edges: [number, number][] = [[0, 1], [1, 2], [0, 3], [3, 4], [2, 4], [1, 4]];
  return (
    <div className="flex h-full items-center justify-center">
      <div className="relative rounded-3xl" style={{ width: 460, height: 340, background: "#111827" }}>
        <svg className="absolute inset-0" viewBox="0 0 460 340" fill="none">
          {edges.map(([a, b], i) => (
            <line key={i}
              x1={nodes[a].x + nodes[a].size / 2} y1={nodes[a].y + nodes[a].size / 2}
              x2={nodes[b].x + nodes[b].size / 2} y2={nodes[b].y + nodes[b].size / 2}
              stroke="#78a9ff" strokeWidth="1.5" strokeDasharray="4 6" opacity="0.35" />
          ))}
        </svg>
        {nodes.map((n, i) => (
          <Char key={n.name} name={n.name} blink={blinks[i]} x={n.x} y={n.y} size={n.size}
            style={{ animation: `hero-float-sm ${5 + i}s ease-in-out infinite ${i * 0.4}s` }} />
        ))}
        {[
          { x: 30, y: 20, s: 3 }, { x: 430, y: 40, s: 4 }, { x: 180, y: 140, s: 3 },
          { x: 400, y: 280, s: 3 }, { x: 50, y: 300, s: 4 }, { x: 250, y: 10, s: 3 },
        ].map(({ x, y, s }, i) => (
          <Dot key={i} x={x} y={y} size={s} color="#78a9ff"
            anim={`hero-twinkle ${2.5 + i * 0.3}s ease-in-out infinite ${i * 0.5}s`} />
        ))}
      </div>
    </div>
  );
}

/* V10 — Workshop: characters at an isometric desk */
function HeroWorkshop({ blinks }: VariantProps) {
  return (
    <div className="flex h-full items-end justify-center pb-12">
      <div className="relative" style={{ width: 480, height: 300 }}>
        <div className="absolute rounded-lg" style={{ left: 0, top: 200, width: 480, height: 100, background: "var(--muted)", borderTop: "2px solid var(--input)" }} />
        <div className="absolute rounded-t-lg" style={{ left: 40, top: 80, width: 200, height: 130, background: "#1a1a2e", border: "2px solid #2a2a4a" }} />
        <div className="absolute rounded" style={{ left: 20, top: 208, width: 240, height: 12, background: "#333", borderRadius: 2 }} />
        <Char name="stack" blink={blinks[0]} x={100} y={100} size={80}
          style={{ animation: "hero-float-sm 6s ease-in-out infinite", opacity: 0.9 }} />
        <svg className="absolute" style={{ left: 300, top: 160, width: 50, height: 60 }} viewBox="0 0 50 60" fill="none">
          <rect x="5" y="12" width="30" height="40" rx="4" fill={TERRACOTTA} opacity="0.7" />
          <path d="M35 22 Q48 22 48 34 Q48 46 35 46" stroke={TERRACOTTA} strokeWidth="3" fill="none" opacity="0.5" />
          <path d="M14 8 Q14 0 18 0 Q22 0 22 8" stroke="var(--muted-foreground)" strokeWidth="1.5" fill="none" opacity="0.3" />
        </svg>
        <div className="absolute rounded" style={{
          left: 370, top: 140, width: 80, height: 60,
          background: "var(--background)", border: "1.5px solid var(--input)", transform: "rotate(5deg)",
        }}>
          {[10, 22, 34, 46].map((top, i) => (
            <div key={i} className="absolute rounded" style={{
              left: 10, top, width: [40, 55, 30, 45][i], height: 3, background: "var(--input)",
            }} />
          ))}
        </div>
        <Char name="tower" blink={blinks[1]} x={280} y={110} size={90}
          style={{ animation: "hero-float-sm 7s ease-in-out infinite 0.5s" }} />
        <Char name="lens" blink={blinks[2]} x={390} y={120} size={80}
          style={{ animation: "hero-float-sm 5s ease-in-out infinite 1s", transform: "rotate(8deg)" }} />
      </div>
    </div>
  );
}

export function CharacterPlayground() {
  injectHeroStyles();
  const [variant, setVariant] = useState(1);
  const blinks = [
    useBlinkCycle(2200, 4800),
    useBlinkCycle(3000, 5500),
    useBlinkCycle(2800, 5000),
    useBlinkCycle(2500, 4500),
    useBlinkCycle(3200, 5200),
  ];

  useEffect(() => {
    const handler = (e: Event) => setVariant((e as CustomEvent).detail);
    window.addEventListener("hero-variant", handler);
    return () => window.removeEventListener("hero-variant", handler);
  }, []);

  return (
    <div
      className="pointer-events-none absolute top-0 right-0 bottom-0 hidden w-[55%] overflow-hidden lg:block"
      aria-hidden="true"
    >
      {variant === 1 && <HeroHuddle blinks={blinks} />}
      {variant === 2 && <HeroPipeline blinks={blinks} />}
      {variant === 3 && <HeroTotem blinks={blinks} />}
      {variant === 4 && <HeroNightShift blinks={blinks} />}
      {variant === 5 && <HeroBlastOff blinks={blinks} />}
      {variant === 6 && <HeroParade blinks={blinks} />}
      {variant === 7 && <HeroTerrarium blinks={blinks} />}
      {variant === 8 && <HeroGrid blinks={blinks} />}
      {variant === 9 && <HeroConstellation blinks={blinks} />}
      {variant === 10 && <HeroWorkshop blinks={blinks} />}
    </div>
  );
}

/* ── Bottom stacked characters (draggable) ─────────────────────────── */

const STACK_STYLES = `
@keyframes char-squish {
  0%   { transform: var(--rest-transform) scale(1, 1); }
  20%  { transform: var(--rest-transform) scale(1.18, 0.82); }
  40%  { transform: var(--rest-transform) scale(0.94, 1.06); }
  60%  { transform: var(--rest-transform) scale(1.04, 0.97); }
  80%  { transform: var(--rest-transform) scale(0.98, 1.02); }
  100% { transform: var(--rest-transform) scale(1, 1); }
}
`;

let stackStylesInjected = false;
function injectStackStyles() {
  if (stackStylesInjected) return;
  stackStylesInjected = true;
  const el = document.createElement("style");
  el.textContent = STACK_STYLES;
  document.head.appendChild(el);
}

function DraggableChar({
  size,
  initialX,
  initialY,
  rotation,
  zIndex,
  children,
}: {
  size: number;
  initialX: number;
  initialY: number;
  rotation: number;
  zIndex: number;
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState({ x: initialX, y: initialY });
  const [dragging, setDragging] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [activeZ, setActiveZ] = useState(zIndex);
  const dragOffset = useRef({ x: 0, y: 0 });
  const elRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dragging) return;

    function onMove(e: MouseEvent | TouchEvent) {
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
      setPos({
        x: clientX - dragOffset.current.x,
        y: clientY - dragOffset.current.y,
      });
    }

    function onUp() {
      setDragging(false);
      setDropping(true);
      setTimeout(() => setDropping(false), 500);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };
  }, [dragging]);

  function onStart(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    setActiveZ(10);
    setDropping(false);
    const clientX =
      "touches" in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY =
      "touches" in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;

    const rect = elRef.current?.getBoundingClientRect();
    dragOffset.current = {
      x: clientX - (rect?.left ?? pos.x),
      y: clientY - (rect?.top ?? pos.y),
    };
    setDragging(true);
  }

  const restTransform = `rotate(${rotation}deg)`;

  return (
    <div
      ref={elRef}
      className="select-none"
      style={{
        position: "absolute",
        left: dragging ? undefined : pos.x,
        top: dragging ? undefined : pos.y,
        ...(dragging
          ? {
              position: "fixed",
              left: pos.x,
              top: pos.y,
            }
          : {}),
        width: size,
        height: size,
        cursor: dragging ? "grabbing" : "grab",
        zIndex: dragging ? 50 : activeZ,
        transform: dropping ? undefined : restTransform,
        filter: dragging
          ? "drop-shadow(0 16px 32px rgba(0,0,0,0.18))"
          : "drop-shadow(0 4px 12px rgba(0,0,0,0.08))",
        transition: dragging ? "none" : "filter 0.2s",
        ["--rest-transform" as string]: restTransform,
        animation: dropping ? "char-squish 0.45s ease-out forwards" : undefined,
      }}
      onMouseDown={onStart}
      onTouchStart={onStart}
    >
      {children}
    </div>
  );
}

export function StackedCharacters() {
  injectStackStyles();
  const b1 = useBlinkCycle(2200, 4800);
  const b2 = useBlinkCycle(3000, 5500);
  const b3 = useBlinkCycle(2800, 5000);

  return (
    <div className="relative hidden h-[340px] w-[320px] lg:block">
      <DraggableChar
        size={180}
        initialX={20}
        initialY={140}
        rotation={-6}
        zIndex={1}
      >
        <svg viewBox="0 0 3486 3486" fill="none" aria-hidden="true">
          <RollerEyes blink={b3} />
          <RollerBody />
        </svg>
      </DraggableChar>

      <DraggableChar
        size={200}
        initialX={80}
        initialY={60}
        rotation={5}
        zIndex={2}
      >
        <svg viewBox="0 0 3486 3486" fill="none" aria-hidden="true">
          <SparkEyes blink={b2} />
          <SparkBody />
        </svg>
      </DraggableChar>

      <DraggableChar
        size={160}
        initialX={60}
        initialY={0}
        rotation={-3}
        zIndex={3}
      >
        <svg viewBox="0 0 125 125" fill="none" aria-hidden="true">
          <CompassEyes blink={b1} />
          <CompassBody />
        </svg>
      </DraggableChar>
    </div>
  );
}
