import type { ReactNode } from "react";

import { getBrand } from "@/brand";
import { cn } from "@/lib/utils";

// Geometry mirrors the agents empty-state reference SVG: a 600x400 canvas,
// a dashed r=199.5 circle centered at (300, 200), and 1px #DDE1E6 cards.
export const ILLUSTRATION_CARD =
  "absolute rounded-lg border border-border bg-card shadow-[0_4px_27px_rgba(56,56,56,0.1)]";

const CIRCLE_R = 199.5;

export function circlePoint(degrees: number) {
  const rad = (degrees * Math.PI) / 180;
  return {
    cx: 300 + CIRCLE_R * Math.cos(rad),
    cy: 200 + CIRCLE_R * Math.sin(rad),
  };
}

export const TILE_TOP_RIGHT = { cx: 467.75, cy: 92 };
export const TILE_LEFT = { cx: 100.75, cy: 210 };

export function IllustrationCanvas({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      aria-hidden
      className={cn("relative h-[400px] w-[600px] shrink-0", className)}
    >
      <svg
        className="absolute inset-0"
        width="600"
        height="400"
        viewBox="0 0 600 400"
        fill="none"
      >
        <circle
          cx="300"
          cy="200"
          r={CIRCLE_R}
          stroke="#DDE1E6"
          strokeDasharray="5 5"
        />
      </svg>
      {children}
    </div>
  );
}

export function IconTile({
  cx,
  cy,
  children,
}: {
  cx: number;
  cy: number;
  children: ReactNode;
}) {
  return (
    <div
      className="absolute flex size-[35px] items-center justify-center rounded-[7.5px] border border-[#DDE1E6] bg-white text-black"
      style={{ left: cx - 17.5, top: cy - 17.5 }}
    >
      {children}
    </div>
  );
}

export function IconSquare({ children }: { children: ReactNode }) {
  return (
    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-white text-foreground">
      {children}
    </div>
  );
}

export function SlackComposer({
  className,
  icon,
  children,
}: {
  className: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={cn(ILLUSTRATION_CARD, "w-[380px] px-4 py-3", className)}>
      {icon}
      <p className="mt-2 text-[14px] leading-6 text-foreground">{children}</p>
      <div className="mt-[7px] flex items-center justify-between border-t border-border pt-2">
        <div className="flex gap-1.5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="size-5 rounded bg-[#4D5358]/10" />
          ))}
        </div>
        <div className="flex size-7 items-center justify-center rounded bg-[#007A5A]">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <path
              d="M8.312 14L19.688 8.312L14 19.688L12.688 15.312L8.312 14Z"
              fill="white"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}

export function SlackMessage({
  className,
  author = "agent",
  time,
  children,
}: {
  className: string;
  author?: "agent" | "person";
  time: string;
  children: ReactNode;
}) {
  const brand = getBrand();
  return (
    <div
      className={cn(
        ILLUSTRATION_CARD,
        "flex w-[380px] gap-2.5 px-4 py-3",
        className,
      )}
    >
      {author === "agent" ? (
        <div className="flex size-8 shrink-0 items-center justify-center rounded bg-gradient-to-br from-white via-white to-[#E3EAFD]">
          <span className="text-[9px] font-bold leading-none text-black">
            {brand.name}
          </span>
        </div>
      ) : (
        <div className="size-8 shrink-0 rounded bg-[#C1C7CD]" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex h-6 items-center gap-2">
          <span className="text-[15px] font-bold text-foreground">
            {author === "agent" ? brand.name : "You"}
          </span>
          {author === "agent" && (
            <span className="flex h-[18px] items-center rounded bg-[#4D5358]/15 px-1 text-[10px] font-semibold uppercase tracking-[0.02em] text-muted-foreground">
              Agent
            </span>
          )}
          <span className="text-[14px] text-muted-foreground/60">{time}</span>
        </div>
        <div className="mt-1 text-[15px] leading-[23px] text-foreground">
          {children}
        </div>
      </div>
    </div>
  );
}

export function SlackLink({ children }: { children: ReactNode }) {
  return <span className="block truncate text-[#1264A3]">{children}</span>;
}

export function Bar({
  className,
  tone = "line",
}: {
  className: string;
  tone?: "title" | "line" | "pass" | "fail";
}) {
  const color = {
    title: "bg-[#4D5358]",
    line: "bg-[#DDE1E6]",
    pass: "bg-[#24A148]",
    fail: "bg-[#DA1E28]",
  }[tone];
  return <div className={cn("shrink-0 rounded-full", color, className)} />;
}
