import { ArrowLeft } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

/** Shared chrome for the full-view takeovers that gate an agent's chat: a
 *  centered content column over the whole surface. Desktop needs no back
 *  affordance — the icon rail stays visible beside the takeover, so Home is
 *  always one click away. Mobile has neither rail nor bottom bar in chat, and
 *  the header's own back button sits beneath this overlay, so it keeps an
 *  icon-only escape hatch. That icon is the only way out at the one width where
 *  the target is exclusively touch, hence `icon` sizing rather than the
 *  label-era `inline`, which would collapse the box onto the 14 px glyph. */
export function OverlayFrame({
  onBack,
  children,
}: {
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div className="absolute inset-0 z-overlay flex flex-col bg-background/95 backdrop-blur-sm">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Back"
        onClick={onBack}
        className="absolute left-1 top-0 text-muted-foreground hover:bg-transparent md:hidden"
      >
        <ArrowLeft size={14} />
      </Button>
      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
        {children}
      </div>
    </div>
  );
}
