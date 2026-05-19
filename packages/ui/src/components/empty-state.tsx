import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type EmptyStatePalette = "aurora" | "sunset" | "forest";

/**
 * Static layered radial gradients matching the login-page backdrop
 * palettes. Each set of four soft blobs is positioned in a fixed pattern
 * — no animation, but the layered hot-spots give the surface a similar
 * "ambient color field" quality. A vertical white wash sits on top so
 * the color reads strongest at the top of the card and fades clean to
 * white at the bottom.
 */
const FADE = "linear-gradient(to bottom, transparent 0%, transparent 25%, white 90%)";

// Pulled way down (≈¼ of the login backdrop's animated peaks). The login
// reads light because its blobs are constantly moving — a static version
// at the same opacity looks like a slab of paint, so we crank it down.
const BACKGROUND_BY_PALETTE: Record<EmptyStatePalette, string> = {
  aurora: [
    FADE,
    "radial-gradient(circle at 85% 12%, rgba(120, 169, 255, 0.18), transparent 55%)",
    "radial-gradient(circle at 8% 78%, rgba(190, 149, 255, 0.14), transparent 55%)",
    "radial-gradient(circle at 65% 75%, rgba(255, 126, 182, 0.10), transparent 55%)",
    "radial-gradient(circle at 25% 18%, rgba(138, 63, 252, 0.08), transparent 50%)",
  ].join(", "),
  sunset: [
    FADE,
    "radial-gradient(circle at 88% 18%, rgba(255, 174, 107, 0.18), transparent 55%)",
    "radial-gradient(circle at 5% 70%, rgba(255, 131, 137, 0.14), transparent 55%)",
    "radial-gradient(circle at 60% 80%, rgba(250, 117, 163, 0.10), transparent 55%)",
    "radial-gradient(circle at 30% 15%, rgba(209, 39, 113, 0.07), transparent 50%)",
  ].join(", "),
  forest: [
    FADE,
    "radial-gradient(circle at 85% 15%, rgba(130, 207, 255, 0.18), transparent 55%)",
    "radial-gradient(circle at 8% 72%, rgba(8, 189, 186, 0.14), transparent 55%)",
    "radial-gradient(circle at 62% 78%, rgba(0, 179, 134, 0.10), transparent 55%)",
    "radial-gradient(circle at 28% 18%, rgba(0, 93, 93, 0.07), transparent 50%)",
  ].join(", "),
};

/**
 * Shared "rich" empty-state card. Used on the Agents / Providers /
 * Connections pages as the first-run coaching surface — title, prose,
 * optional plain bulleted list of what-you-can-do points, and a single
 * primary CTA. Each consuming view picks a {@link EmptyStatePalette}
 * so the three pages share a vocabulary but read distinctly.
 */
export function EmptyState({
  title,
  description,
  bullets,
  action,
  secondaryAction,
  palette = "aurora",
  className,
}: {
  title: string;
  description: ReactNode;
  bullets?: ReactNode[];
  action?: ReactNode;
  secondaryAction?: ReactNode;
  palette?: EmptyStatePalette;
  className?: string;
}) {
  return (
    <div
      style={{ background: BACKGROUND_BY_PALETTE[palette] }}
      className={cn(
        "relative rounded-2xl px-6 py-10 md:px-12 md:py-14 anim-in overflow-hidden",
        className,
      )}
    >
      <div className="relative max-w-xl">
        <h2 className="text-[22px] md:text-[26px] font-semibold tracking-tight leading-tight mb-3">
          {title}
        </h2>
        <div className="text-[14px] text-foreground/80 leading-relaxed mb-5">
          {description}
        </div>
        {bullets && bullets.length > 0 && (
          <ul className="list-disc pl-5 marker:text-muted-foreground flex flex-col gap-2 mb-6 text-[13px] text-foreground/80">
            {bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        )}
        {(action || secondaryAction) && (
          <div className="flex flex-wrap items-center gap-2">
            {action}
            {secondaryAction}
          </div>
        )}
      </div>
    </div>
  );
}
