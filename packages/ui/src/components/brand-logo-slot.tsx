import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { BrandLogo } from "./brand-logo.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The brand's place in a navigation header: the nav
 * items' own 16px icon column, padded like a nav item by the caller. The logo
 * keeps its own width and overflows the slot evenly on both sides, so the
 * wordmark's centre sits on the column whatever width the brand's logo has.
 */
export function BrandLogoSlot({
  logoClassName,
  children,
}: {
  logoClassName?: string;
  children?: ReactNode;
}) {
  return (
    <span className="relative flex size-4 shrink-0 items-center justify-center">
      <BrandLogo className={cn("shrink-0", logoClassName)} />
      {children}
    </span>
  );
}
