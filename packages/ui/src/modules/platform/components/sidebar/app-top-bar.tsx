import type { ReactNode } from "react";

import { getBrand } from "../../../../brand.js";
import { useStore } from "../../../../store.js";
import type { View } from "../../lib/routes.js";
import { MobileMenuButton } from "./mobile-menu-button.js";

const TITLES: Partial<Record<View, string>> = {
  artifacts: "Artifacts",
  settings: "Settings",
  "starter-kit": "Starter kits",
  "sandbox-home": "Configure agent",
};

export function AppTopBar({ actions }: { actions: ReactNode }) {
  const view = useStore((s) => s.view);
  const title = TITLES[view] ?? getBrand().name;

  return (
    <div className="sticky top-0 z-raised flex items-center gap-2 px-4 pt-3 pointer-events-none max-md:h-[52px] max-md:border-b max-md:border-border max-md:bg-background max-md:pt-0 md:justify-end md:px-6">
      <div className="pointer-events-auto flex min-w-0 flex-1 items-center gap-2 md:hidden">
        <MobileMenuButton />
        <span className="truncate text-sm font-semibold text-foreground">
          {title}
        </span>
      </div>
      <div className="pointer-events-auto">{actions}</div>
    </div>
  );
}
