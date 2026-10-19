import type { ReactNode } from "react";

import { getBrand } from "../../../../brand.js";
import { useStore } from "../../../../store.js";
import type { View } from "../../lib/routes.js";
import { MobileMenuButton } from "./mobile-menu-button.js";

const TITLES: Partial<Record<View, string>> = {
  settings: "Settings",
  "starter-kit": "Starter kits",
  "sandbox-home": "Configure agent",
};

export function AppTopBar({ actions }: { actions: ReactNode }) {
  const view = useStore((s) => s.view);
  const title = TITLES[view] ?? getBrand().name;

  return (
    <div className="sticky top-0 z-raised flex h-[52px] items-center gap-2 border-b border-border bg-background px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <MobileMenuButton />
        <span className="truncate text-sm font-semibold text-foreground">
          {title}
        </span>
      </div>
      <div className="flex items-center gap-1">{actions}</div>
    </div>
  );
}
