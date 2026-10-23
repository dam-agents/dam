import { Close } from "@carbon/icons-react";
import {
  createContext,
  type MouseEvent,
  type ReactNode,
  useContext,
} from "react";

import { Button } from "@/components/ui/button";
import { RAIL_GLYPH, railTile } from "@/components/ui/rail-tile";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { RightToolbarTiles } from "./right-toolbar-tiles.js";

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
 * bar's open tab, or to the main region; a phone hides it, because the
 * full-screen panel there has its own back button, unless the panel keeps a
 * top bar of its own instead. Under the Unified right toolbar experiment it
 * is a 40 px tile of the rail's size rather than the small ghost button.
 */
export function SidePanelCloseButton({ onClose }: { onClose?: () => void }) {
  const tiles = useContext(RightToolbarTiles);
  return <PanelCloseButton onClose={onClose} tiles={tiles} />;
}

// UNIT_BOUNDARY_DESCRIPTION: the X's chrome and close behavior, told which variant the panel's shell draws so an open panel updates with the Unified right toolbar experiment instead of reading a marker off the root.
export function PanelCloseButton({
  onClose,
  tiles,
}: {
  onClose?: () => void;
  tiles: boolean;
}) {
  // UNIT_BOUNDARY_DESCRIPTION: JanUI, and any shell whose panel keeps a top bar of its own under the Unified right toolbar experiment, draw no back button over a narrow panel, so those panels keep the X; the layout is read off the root, which does not change without a reload.
  const newLayout =
    typeof document !== "undefined" &&
    document.documentElement.dataset.layout === "new";
  const close = (e: MouseEvent<HTMLButtonElement>) => {
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
  };
  return (
    <ShownWhereItCloses ownClose={onClose !== undefined}>
      <div
        className={cn(
          "flex shrink-0 items-center self-stretch border-l border-border pl-2",
          !newLayout && !tiles && "max-md:hidden",
        )}
      >
        {tiles ? (
          <Tooltip content="Close panel" side="left">
            <button
              type="button"
              aria-label="Close panel"
              data-testid="side-panel-close"
              className={railTile(false)}
              onClick={close}
            >
              <Close size={RAIL_GLYPH} />
            </button>
          </Tooltip>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close panel"
            tooltip="Close panel"
            data-testid="side-panel-close"
            onClick={close}
          >
            <Close size={16} />
          </Button>
        )}
      </div>
    </ShownWhereItCloses>
  );
}
