import { Close } from "@carbon/icons-react";
import { useState } from "react";

import { BrandLogo } from "@/components/brand-logo";
import { SideDrawer } from "@/components/ui/side-drawer";

import { useStore } from "../../../../store.js";
import { SidebarContent } from "./sidebar-content.js";

export function MobileNavDrawer() {
  const open = useStore((s) => s.mobileNavOpen);
  if (!open) return null;
  return <OpenDrawer />;
}

function OpenDrawer() {
  const setMobileNavOpen = useStore((s) => s.setMobileNavOpen);
  const [closing, setClosing] = useState(false);
  const close = () => setClosing(true);

  return (
    <SideDrawer
      side="left"
      label="Navigation"
      closing={closing}
      onClose={close}
      onClosed={() => setMobileNavOpen(false)}
      className="max-w-[340px] bg-card px-2 safe-bottom"
    >
      <div className="flex items-center justify-between pt-3 pb-1 pl-1">
        <BrandLogo />
        <button
          type="button"
          onClick={close}
          aria-label="Close navigation"
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Close size={16} />
        </button>
      </div>
      <div data-testid="mobile-nav" className="flex min-h-0 flex-1 flex-col">
        <SidebarContent onNavigate={() => setMobileNavOpen(false)} />
      </div>
    </SideDrawer>
  );
}
