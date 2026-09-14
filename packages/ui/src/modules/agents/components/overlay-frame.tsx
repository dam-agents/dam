import { ArrowLeft } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

export function OverlayFrame({
  onBack,
  footer,
  children,
}: {
  onBack: () => void;
  footer?: ReactNode;
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
      {footer && <div className="flex justify-center px-6 pb-10">{footer}</div>}
    </div>
  );
}
