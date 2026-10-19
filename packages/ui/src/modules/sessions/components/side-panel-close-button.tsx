import { Close } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The X that ends every side panel's top bar,
 * behind a vertical border so it does not read as one of the panel's own
 * actions. It closes the whole panel and hands focus to the rail's open tab,
 * which stays on screen; a phone hides it, because the full-screen panel
 * there has its own back button.
 */
export function SidePanelCloseButton({ onClose }: { onClose?: () => void }) {
  return (
    <div className="flex shrink-0 items-center self-stretch border-l border-border pl-2 max-md:hidden">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Close panel"
        tooltip="Close panel"
        data-testid="side-panel-close"
        onClick={(e) => {
          const bar = e.currentTarget
            .closest('[data-testid="side-panel"]')
            ?.querySelector('[data-testid="side-panel-bar"]');
          (
            bar?.querySelector<HTMLElement>('[aria-pressed="true"]') ??
            bar?.querySelector<HTMLElement>("button")
          )?.focus();
          (onClose ?? (() => useStore.getState().setSidePanelTab(null)))();
        }}
      >
        <Close size={16} />
      </Button>
    </div>
  );
}
