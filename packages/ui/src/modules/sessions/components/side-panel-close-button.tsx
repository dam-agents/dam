import { Close } from "@carbon/icons-react";
import { createContext, type ReactNode, useContext } from "react";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";

const ClosesSidePanel = createContext(true);

/**
 * UNIT_BOUNDARY_DESCRIPTION: Marks a region where clearing the side-panel tab
 * closes nothing, such as the classic chat's sections and docked item. There
 * the X shows only for a panel that brings its own close.
 */
export const SidePanelCloseScope = ClosesSidePanel.Provider;

function ShownWhereItCloses({
  ownClose,
  children,
}: {
  ownClose: boolean;
  children: ReactNode;
}) {
  const closes = useContext(ClosesSidePanel);
  return ownClose || closes ? children : null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The X that ends every side panel's top bar,
 * behind a vertical border so it does not read as one of the panel's own
 * actions. It closes the whole panel and hands focus to the rail's open tab,
 * which stays on screen; with no rail, as in the classic chat, to the top
 * bar's open tab, or to the main region; a phone hides it, because the full-screen panel
 * there has its own back button.
 */
export function SidePanelCloseButton({ onClose }: { onClose?: () => void }) {
  return (
    <ShownWhereItCloses ownClose={onClose !== undefined}>
      <div className="flex shrink-0 items-center self-stretch border-l border-border pl-2 max-md:hidden">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close panel"
          tooltip="Close panel"
          data-testid="side-panel-close"
          onClick={(e) => {
            const page = e.currentTarget.ownerDocument;
            const bar = e.currentTarget
              .closest('[data-testid="side-panel"]')
              ?.querySelector('[data-testid="side-panel-bar"]');
            (bar
              ? (bar.querySelector<HTMLElement>('[aria-pressed="true"]') ??
                bar.querySelector<HTMLElement>("button"))
              : (page.querySelector<HTMLElement>(
                  '[data-testid^="side-panel-tab-"][aria-pressed="true"]',
                ) ?? page.getElementById("main"))
            )?.focus();
            (onClose ?? (() => useStore.getState().setSidePanelTab(null)))();
          }}
        >
          <Close size={16} />
        </Button>
      </div>
    </ShownWhereItCloses>
  );
}
