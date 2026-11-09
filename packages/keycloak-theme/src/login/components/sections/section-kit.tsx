import type { ReactNode } from "react";

/* UNIT_BOUNDARY_DESCRIPTION: The typography and colours every section of the
 * login page shares: the small upper-case label, the section heading, the card
 * style, and the shape colours the first screen also uses. */

export const SHAPE_COLOR = {
  blue: "#5B76D2",
  gold: "#DE9950",
  rust: "#CA6040",
  green: "#3F6C45",
  pink: "#E89DA8",
} as const;

export const CARD =
  "rounded-xl border border-input bg-background shadow-[0_2px_16px_rgba(0,0,0,0.06)]";

export function SectionLabel({
  children,
  color,
}: {
  children: ReactNode;
  color?: string;
}) {
  return (
    <p
      className="text-muted-foreground text-[13px] font-semibold tracking-[0.1em] uppercase"
      style={color ? { color } : undefined}
    >
      {children}
    </p>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-foreground mt-3 text-[32px] leading-[1.15] font-light -tracking-[0.02em] md:text-[40px]">
      {children}
    </h2>
  );
}

export function ExternalLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className={className ?? "text-accent hover:underline"}
    >
      {children}
    </a>
  );
}
