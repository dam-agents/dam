import { SendFilled } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { SlackColorIcon } from "@/components/brand-icons";
import { cn } from "@/lib/utils";

import { getBrand } from "../../brand.js";

export function EmptyHero({
  title,
  children,
  actions,
  illustration,
}: {
  title: string;
  children: ReactNode;
  actions: ReactNode;
  illustration: ReactNode;
}) {
  return (
    <div className="@container anim-in">
      <div className="grid min-h-[70dvh] items-center gap-12 py-8 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="flex max-w-[560px] flex-col gap-4">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          <p className="text-base/7 text-muted-foreground">{children}</p>
          <div className="mt-2 flex flex-wrap gap-2">{actions}</div>
        </div>
        <div
          aria-hidden
          className="pointer-events-none relative hidden select-none @4xl:block"
        >
          <div className="absolute inset-x-[12%] -inset-y-6 rounded-full border border-dashed border-border" />
          <div className="relative">{illustration}</div>
        </div>
      </div>
    </div>
  );
}

export function MockCard({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-4 text-sm text-foreground shadow-[0_4px_16px_rgb(0_0_0/0.06)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function MockChip({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "absolute flex size-8 items-center justify-center rounded-md border border-border bg-card",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function MockPrompt({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <MockCard className={className}>
      <SlackColorIcon className="size-4" />
      <p className="mt-2 border-b border-border pb-2 text-sm/6">{children}</p>
      <div className="mt-2 flex items-center gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="size-4 rounded-sm bg-muted" />
        ))}
        <span className="ml-auto flex size-6 items-center justify-center rounded-sm bg-success text-white">
          <SendFilled size={12} className="-rotate-45" />
        </span>
      </div>
    </MockCard>
  );
}

export function MockAgentMessage({
  className,
  time,
  children,
}: {
  className?: string;
  time: string;
  children: ReactNode;
}) {
  const { name, short } = getBrand();
  return (
    <MockCard className={cn("flex gap-3", className)}>
      <span className="flex size-6 shrink-0 items-center justify-center rounded-sm bg-gradient-to-br from-card to-accent-light text-[7px] font-bold uppercase">
        {short.slice(0, 3)}
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold">{name}</span>
          <span className="rounded-sm bg-muted px-1 text-[9px] font-medium tracking-wide text-muted-foreground">
            AGENT
          </span>
          <span className="text-xs text-muted-foreground">{time}</span>
        </div>
        <div className="mt-1 text-sm/6">{children}</div>
      </div>
    </MockCard>
  );
}
