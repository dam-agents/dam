import { Menu } from "@carbon/icons-react";

import { Tooltip } from "@/components/ui/tooltip";

import { useStore } from "../../../../store.js";

export function MobileMenuButton() {
  const setMobileNavOpen = useStore((s) => s.setMobileNavOpen);
  return (
    <Tooltip content="Open navigation">
      <button
        type="button"
        aria-label="Open navigation"
        data-testid="open-mobile-nav"
        onClick={() => setMobileNavOpen(true)}
        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-foreground/80 transition-colors hover:bg-muted hover:text-foreground md:hidden"
      >
        <Menu size={20} />
      </button>
    </Tooltip>
  );
}
