import type React from "react";

import { cn } from "@/lib/utils";

import type { AgentDisplayState } from "../utils/agent-resolver.js";
import { type BeeColors, hashIndex, injectBeeStyles } from "./bee-avatar.js";

export type { BeeColors };
export { hashIndex };

const LENS_EYES: [number, number, number][] = [
  [1100, 900, 340],
  [1900, 700, 280],
  [2500, 1150, 310],
  [700, 1700, 300],
  [1650, 1650, 380],
  [2350, 2100, 260],
  [1200, 2500, 320],
];

export const EYE_CX_L = 1391;
export const EYE_CX_R = 2094;
export const EYE_R = 249;

export function cpth(cx: number, cy: number, r: number): string {
  const k = r * 0.552;
  return `M${cx} ${cy - r}C${cx - k} ${cy - r} ${cx - r} ${cy - k} ${cx - r} ${cy}C${cx - r} ${cy + k} ${cx - k} ${cy + r} ${cx} ${cy + r}C${cx + k} ${cy + r} ${cx + r} ${cy + k} ${cx + r} ${cy}C${cx + r} ${cy - k} ${cx + k} ${cy - r} ${cx} ${cy - r}Z`;
}

export function dPathL(x: number, cy: number, r: number): string {
  const k = r * 0.552;
  return `M${x} ${cy + r}C${x - k} ${cy + r} ${x - r} ${cy + k} ${x - r} ${cy}C${x - r} ${cy - k} ${x - k} ${cy - r} ${x} ${cy - r}L${x} ${cy + r}Z`;
}

export function dPathR(x: number, cy: number, r: number): string {
  const k = r * 0.552;
  return `M${x} ${cy - r}C${x + k} ${cy - r} ${x + r} ${cy - k} ${x + r} ${cy}C${x + r} ${cy + k} ${x + k} ${cy + r} ${x} ${cy + r}L${x} ${cy - r}Z`;
}

export function dPathU(cx: number, y: number, r: number): string {
  const k = r * 0.552;
  return `M${cx - r} ${y}C${cx - r} ${y - k} ${cx - k} ${y - r} ${cx} ${y - r}C${cx + k} ${y - r} ${cx + r} ${y - k} ${cx + r} ${y}L${cx - r} ${y}Z`;
}

export function dPathD(cx: number, y: number, r: number): string {
  const k = r * 0.552;
  return `M${cx + r} ${y}C${cx + r} ${y + k} ${cx + k} ${y + r} ${cx} ${y + r}C${cx - k} ${y + r} ${cx - r} ${y + k} ${cx - r} ${y}L${cx + r} ${y}Z`;
}

export const CHAR_NAMES = [
  "stack",
  "shield",
  "roller",
  "tower",
  "wave",
  "compass",
  "spark",
  "lens",
] as const;

export type CharName = (typeof CHAR_NAMES)[number];
export type FillArg = string | BeeColors;

type CharRenderer = (fill: FillArg) => React.ReactNode;

export function charFill(
  fill: FillArg,
  part: "eyes" | "body" | "wings",
): string {
  return typeof fill === "string" ? fill : fill[part];
}

export const CHAR_COLORS: Record<CharName, BeeColors> = {
  stack: { eyes: "#E89DA8", body: "#5B76D2", wings: "#5B76D2" },
  shield: { eyes: "#E89DA8", body: "#5B76D2", wings: "#DE9950" },
  roller: { eyes: "#E89DA8", body: "#5B76D2", wings: "#DE9950" },
  tower: { eyes: "#E89DA8", body: "#5B76D2", wings: "#5B76D2" },
  wave: { eyes: "#E89DA8", body: "#CA6040", wings: "#CA6040" },
  compass: { eyes: "#E89DA8", body: "#3F6C45", wings: "#3F6C45" },
  spark: { eyes: "#E89DA8", body: "#CA6040", wings: "#3F6C45" },
  lens: { eyes: "#E89DA8", body: "#5B76D2", wings: "#DE9950" },
};

function CompassSvg({ fill }: { fill: FillArg }) {
  return (
    <svg viewBox="0 0 125 125" fill="none">
      <g className="bee-eyes-sleep">
        <path
          d="M66.80,62.52 A8.94,8.94 0 0 0 84.68,62.52"
          fill="none"
          stroke={charFill(fill, "eyes")}
          strokeWidth="5.74"
        />
        <path
          d="M40.30,62.52 A8.94,8.94 0 0 0 58.19,62.52"
          fill="none"
          stroke={charFill(fill, "eyes")}
          strokeWidth="5.74"
        />
      </g>
      <g className="bee-eyes-wake">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M75.74 53.57C70.80 53.57 66.80 57.58 66.80 62.52C66.80 67.46 70.80 71.46 75.74 71.46C80.68 71.46 84.68 67.46 84.68 62.52C84.68 57.58 80.68 53.57 75.74 53.57Z"
          fill={charFill(fill, "eyes")}
        />
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M49.25 53.57C44.31 53.57 40.30 57.58 40.30 62.52C40.30 67.46 44.31 71.46 49.25 71.46C54.19 71.46 58.19 67.46 58.19 62.52C58.19 57.58 54.19 53.57 49.25 53.57Z"
          fill={charFill(fill, "eyes")}
        />
      </g>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M88.32 85.79L108.71 67.84L108.72 95.73C108.63 100.73 106.21 106.37 99.75 108.40C93.04 110.52 85.81 106.77 83.69 100.05C81.90 94.36 84.20 89.45 88.32 85.79Z"
        fill={charFill(fill, "wings")}
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M88.32 39.20L108.71 57.14L108.72 29.25C108.63 24.26 106.21 18.62 99.75 16.58C93.04 14.47 85.81 18.22 83.69 24.93C81.90 30.62 84.20 35.53 88.32 39.20Z"
        fill={charFill(fill, "wings")}
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M36.43 39.20L16.04 57.14L16.03 29.25C16.12 24.26 18.54 18.62 24.99 16.58C31.71 14.47 38.94 18.22 41.06 24.93C42.85 30.62 40.55 35.53 36.43 39.20Z"
        fill={charFill(fill, "wings")}
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M36.43 85.79L16.04 67.84L16.03 95.73C16.12 100.73 18.54 106.37 24.99 108.40C31.71 110.52 38.94 106.77 41.06 100.05C42.85 94.36 40.55 89.45 36.43 85.79Z"
        fill={charFill(fill, "wings")}
      />
    </svg>
  );
}

const charRenderers: Record<CharName, CharRenderer> = {
  stack: (fill) => (
    <svg viewBox="0 0 3486 3486" fill="none">
      <g className="bee-eyes-sleep">
        <path
          d="M1844.84,696.5 A249.42,249.42 0 0 0 2343.67,696.5"
          fill="none"
          stroke={charFill(fill, "eyes")}
          strokeWidth="160"
        />
        <path
          d="M1142,696.5 A249.42,249.42 0 0 0 1640.84,696.5"
          fill="none"
          stroke={charFill(fill, "eyes")}
          strokeWidth="160"
        />
      </g>
      <g className="bee-eyes-wake">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M2094.25 447C1956.52 447 1844.84 558.7 1844.84 696.5C1844.84 834.3 1956.52 946 2094.25 946C2232 946 2343.67 834.3 2343.67 696.5C2343.67 558.7 2232 447 2094.25 447Z"
          fill={charFill(fill, "eyes")}
        />
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M1391.43 447C1253.67 447 1142 558.7 1142 696.5C1142 834.3 1253.67 946 1391.43 946C1529.18 946 1640.84 834.3 1640.84 696.5C1640.84 558.7 1529.18 447 1391.43 447Z"
          fill={charFill(fill, "eyes")}
        />
      </g>
      <rect
        x="935"
        y="1125"
        width="1616"
        height="489.42"
        fill={charFill(fill, "body")}
      />
      <rect
        x="935"
        y="1837.52"
        width="1616"
        height="489.41"
        fill={charFill(fill, "body")}
      />
      <rect
        x="935"
        y="2550.04"
        width="1616"
        height="489.41"
        fill={charFill(fill, "body")}
      />
    </svg>
  ),

  shield: (fill) => (
    <svg viewBox="0 0 3486 3486" fill="none">
      <g className="bee-eyes-sleep">
        <path
          d="M1844.84,1425.5 A249.42,249.42 0 0 0 2343.67,1425.5"
          fill="none"
          stroke={charFill(fill, "eyes")}
          strokeWidth="160"
        />
        <path
          d="M1142,1425.5 A249.42,249.42 0 0 0 1640.84,1425.5"
          fill="none"
          stroke={charFill(fill, "eyes")}
          strokeWidth="160"
        />
      </g>
      <g className="bee-eyes-wake">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M2094.25 1176C1956.52 1176 1844.84 1287.7 1844.84 1425.5C1844.84 1563.3 1956.52 1675 2094.25 1675C2232 1675 2343.67 1563.3 2343.67 1425.5C2343.67 1287.7 2232 1176 2094.25 1176Z"
          fill={charFill(fill, "eyes")}
        />
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M1391.43 1176C1253.67 1176 1142 1287.7 1142 1425.5C1142 1563.3 1253.67 1675 1391.43 1675C1529.18 1675 1640.84 1563.3 1640.84 1425.5C1640.84 1287.7 1529.18 1176 1391.43 1176Z"
          fill={charFill(fill, "eyes")}
        />
      </g>
      <rect
        x="1189"
        y="1898"
        width="1126"
        height="489"
        fill={charFill(fill, "body")}
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M966 2551C661.827 2408.46 450 2099.72 450 1742.07C450 1384.17 661.492 1077.41 966 935L966 2551Z"
        fill={charFill(fill, "wings")}
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M2538 2551C2842.17 2408.46 3054 2099.72 3054 1742.07C3054 1384.17 2842.51 1077.41 2538 935V2551Z"
        fill={charFill(fill, "wings")}
      />
    </svg>
  ),

  roller: (fill) => (
    <svg viewBox="0 0 3486 3486" fill="none">
      <g className="bee-eyes-sleep">
        <path
          d="M1842.84,716.5 A249.42,249.42 0 0 0 2341.67,716.5"
          fill="none"
          stroke={charFill(fill, "eyes")}
          strokeWidth="160"
        />
        <path
          d="M1140,716.5 A249.42,249.42 0 0 0 1638.84,716.5"
          fill="none"
          stroke={charFill(fill, "eyes")}
          strokeWidth="160"
        />
      </g>
      <g className="bee-eyes-wake">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M2092.25 467C1954.52 467 1842.84 578.7 1842.84 716.5C1842.84 854.3 1954.52 966 2092.25 966C2230 966 2341.67 854.3 2341.67 716.5C2341.67 578.7 2230 467 2092.25 467Z"
          fill={charFill(fill, "eyes")}
        />
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M1389.43 467C1251.67 467 1140 578.7 1140 716.5C1140 854.3 1251.67 966 1389.43 966C1527.18 966 1638.84 854.3 1638.84 716.5C1638.84 578.7 1527.18 467 1389.43 467Z"
          fill={charFill(fill, "eyes")}
        />
      </g>
      <rect
        x="933"
        y="1189"
        width="1616"
        height="489"
        fill={charFill(fill, "body")}
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M933 1901C1075.54 2205.17 1384.28 2417 1741.93 2417C2099.83 2417 2406.59 2205.51 2549 1901H933Z"
        fill={charFill(fill, "wings")}
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M1046.43 2540C908.675 2540 797 2651.7 797 2789.5C797 2927.3 908.675 3039 1046.43 3039C1184.18 3039 1295.84 2927.3 1295.84 2789.5C1295.84 2651.7 1184.18 2540 1046.43 2540Z"
        fill={typeof fill === "string" ? fill : "#000000"}
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M2439.42 2540C2301.69 2540 2190 2651.7 2190 2789.5C2190 2927.3 2301.69 3039 2439.42 3039C2577.17 3039 2688.84 2927.3 2688.84 2789.5C2688.84 2651.7 2577.17 2540 2439.42 2540Z"
        fill={typeof fill === "string" ? fill : "#000000"}
      />
    </svg>
  ),

  tower: (fill) => (
    <svg viewBox="0 0 3486 3486" fill="none">
      <g className="bee-eyes-sleep">
        <path
          d="M1844.84,1743.5 A249.42,249.42 0 0 0 2343.67,1743.5"
          fill="none"
          stroke={charFill(fill, "eyes")}
          strokeWidth="160"
        />
        <path
          d="M1142,1743.5 A249.42,249.42 0 0 0 1640.84,1743.5"
          fill="none"
          stroke={charFill(fill, "eyes")}
          strokeWidth="160"
        />
      </g>
      <g className="bee-eyes-wake">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M2094.25 1494C1956.52 1494 1844.84 1605.7 1844.84 1743.5C1844.84 1881.3 1956.52 1993 2094.25 1993C2232 1993 2343.67 1881.3 2343.67 1743.5C2343.67 1605.7 2232 1494 2094.25 1494Z"
          fill={charFill(fill, "eyes")}
        />
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M1391.43 1494C1253.67 1494 1142 1605.7 1142 1743.5C1142 1881.3 1253.67 1993 1391.43 1993C1529.18 1993 1640.84 1881.3 1640.84 1743.5C1640.84 1605.7 1529.18 1494 1391.43 1494Z"
          fill={charFill(fill, "eyes")}
        />
      </g>
      <rect
        x="2550"
        y="936"
        width="489"
        height="1616"
        fill={charFill(fill, "body")}
      />
      <rect
        x="446"
        y="935"
        width="489.417"
        height="1616"
        fill={charFill(fill, "body")}
      />
    </svg>
  ),

  wave: (fill) => (
    <svg viewBox="0 0 3486 3486" fill="none">
      <g className="bee-eyes-sleep">
        <path
          d="M1844.84,1541.5 A249.42,249.42 0 0 0 2343.67,1541.5"
          fill="none"
          stroke={charFill(fill, "eyes")}
          strokeWidth="160"
        />
        <path
          d="M1142,1541.5 A249.42,249.42 0 0 0 1640.84,1541.5"
          fill="none"
          stroke={charFill(fill, "eyes")}
          strokeWidth="160"
        />
      </g>
      <g className="bee-eyes-wake">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M2094.25 1292C1956.52 1292 1844.84 1403.7 1844.84 1541.5C1844.84 1679.3 1956.52 1791 2094.25 1791C2232 1791 2343.67 1679.3 2343.67 1541.5C2343.67 1403.7 2232 1292 2094.25 1292Z"
          fill={charFill(fill, "eyes")}
        />
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M1391.43 1292C1253.67 1292 1142 1403.7 1142 1541.5C1142 1679.3 1253.67 1791 1391.43 1791C1529.18 1791 1640.84 1679.3 1640.84 1541.5C1640.84 1403.7 1529.18 1292 1391.43 1292Z"
          fill={charFill(fill, "eyes")}
        />
      </g>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M1743 552C1279.54 552 875.172 799.73 655 1178.76V1389.86C917.95 1088.18 1307.39 895.43 1743 895.43C2178.61 895.43 2568.05 1088.18 2831 1389.86V1178.76C2610.83 799.73 2206.46 552 1743 552Z"
        fill={charFill(fill, "body")}
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M1743 2934C1279.54 2934 875.172 2686.27 655 2307.24V2096.14C917.95 2397.82 1307.39 2590.57 1743 2590.57C2178.61 2590.57 2568.05 2397.82 2831 2096.14V2307.24C2610.83 2686.27 2206.46 2934 1743 2934Z"
        fill={charFill(fill, "body")}
      />
    </svg>
  ),

  compass: (fill) => <CompassSvg fill={fill} />,

  spark: (fill) => (
    <svg viewBox="0 0 3486 3486" fill="none">
      <g className="bee-eyes-sleep">
        <path
          d={`M${EYE_CX_R - EYE_R},680 A${EYE_R},${EYE_R} 0 0 0 ${EYE_CX_R + EYE_R},680`}
          fill="none"
          stroke={charFill(fill, "eyes")}
          strokeWidth="160"
        />
        <path
          d={`M${EYE_CX_L - EYE_R},680 A${EYE_R},${EYE_R} 0 0 0 ${EYE_CX_L + EYE_R},680`}
          fill="none"
          stroke={charFill(fill, "eyes")}
          strokeWidth="160"
        />
      </g>
      <g className="bee-eyes-wake">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d={cpth(EYE_CX_R, 680, EYE_R)}
          fill={charFill(fill, "eyes")}
        />
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d={cpth(EYE_CX_L, 680, EYE_R)}
          fill={charFill(fill, "eyes")}
        />
      </g>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d={cpth(1743, 1858, 611)}
        fill={charFill(fill, "body")}
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d={dPathL(750, 1858, 620)}
        fill={charFill(fill, "wings")}
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d={dPathR(2736, 1858, 620)}
        fill={charFill(fill, "wings")}
      />
    </svg>
  ),

  lens: (fill) => {
    const e = charFill(fill, "eyes");
    return (
      <svg viewBox="0 0 3486 3486" fill="none">
        <g className="bee-eyes-sleep">
          {LENS_EYES.map(([cx, cy, r]) => (
            <path
              key={`${cx}-${cy}`}
              d={`M${cx - r},${cy} A${r},${r} 0 0 0 ${cx + r},${cy}`}
              fill="none"
              stroke={e}
              strokeWidth="160"
              className="lens-eye-closed"
            />
          ))}
        </g>
        <g className="bee-eyes-wake">
          {LENS_EYES.map(([cx, cy, r]) => (
            <path
              key={`${cx}-${cy}`}
              fillRule="evenodd"
              clipRule="evenodd"
              d={cpth(cx, cy, r)}
              fill={e}
              className="lens-eye"
            />
          ))}
        </g>
      </svg>
    );
  },
};

export function CharAvatar({
  agentId,
  name,
  state,
  colors,
  idle,
  className,
}: {
  agentId?: string;
  name?: CharName;
  state: string;
  colors?: BeeColors | string;
  idle?: boolean;
  className?: string;
}) {
  injectBeeStyles();
  const charName =
    name ?? CHAR_NAMES[hashIndex(agentId ?? "", CHAR_NAMES.length)]!;
  const sleeping = state === "hibernated" || state === "hibernating";
  const fill: FillArg = sleeping
    ? "#a2a9b0"
    : (colors ?? CHAR_COLORS[charName]);
  const stateClass = idle
    ? "bee-idle"
    : sleeping
      ? "bee-sleeping"
      : "bee-awake";
  return (
    <div
      className={cn(
        "bee-avatar size-10 shrink-0 self-center",
        charName !== "compass" && "bee-char",
        stateClass,
        className,
      )}
      data-icon={charName}
    >
      {charRenderers[charName](fill)}
    </div>
  );
}

export function AgentAvatar({
  agentId,
  state,
  className,
}: {
  agentId: string;
  state: AgentDisplayState;
  className?: string;
}) {
  const idle = state === "hibernated" || state === "idle_always_on";
  const awake =
    state === "running" ||
    state === "running_always_on" ||
    state === "starting" ||
    state === "preparing_workspace";
  return (
    <CharAvatar
      agentId={agentId}
      state={awake || idle ? "running" : "hibernated"}
      idle={idle}
      className={className}
    />
  );
}
