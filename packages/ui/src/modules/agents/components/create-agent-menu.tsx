import { Add, DataEnrichmentAdd } from "@carbon/icons-react";
import { useRef } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { MenuItemText } from "../../processes/components/menu-item-text.js";
import { useRecordEntryPoint } from "../../usage/api/mutations.js";
import { useCreateDefaultAgent } from "../hooks/use-create-default-agent.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The + of the sidebar's Agents section. It opens a
 * menu with two ways to start, a blank agent or a starter kit, so no agent is
 * created before the user picks one.
 */
export function CreateAgentMenu({ onChoose }: { onChoose?: () => void }) {
  const defaultAgent = useCreateDefaultAgent();
  const recordEntryPoint = useRecordEntryPoint();
  const setKitBrowserOpen = useStore((s) => s.setKitBrowserOpen);
  const kitBrowserAfterMenu = useRef(false);
  return (
    <DropdownMenu>
      <Tooltip content="Create agent" side="right">
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Create agent"
            data-testid="sidebar-create-agent"
            className={cn(
              "flex size-6 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              FOCUS_RING,
            )}
          >
            <Add size={14} />
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent
        side="right"
        align="start"
        className="min-w-56"
        onCloseAutoFocus={() => {
          // UNIT_BOUNDARY_DESCRIPTION: The kit browser opens only when the closed menu hands focus back to the +, so the kit browser returns focus there on close. The menu item it was picked from is gone by then.
          if (!kitBrowserAfterMenu.current) return;
          kitBrowserAfterMenu.current = false;
          setKitBrowserOpen(true);
        }}
      >
        <DropdownMenuItem
          disabled={!defaultAgent.ready}
          onSelect={() => {
            recordEntryPoint.mutate({ choice: "sandbox" });
            void defaultAgent.create();
            onChoose?.();
          }}
          data-testid="sidebar-create-blank-agent"
          className="h-auto items-start py-2"
        >
          <Add size={16} className="mt-0.5 shrink-0" aria-hidden />
          <MenuItemText
            label="Blank agent"
            caption="Start empty and set it up later"
          />
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            recordEntryPoint.mutate({ choice: "starter-kit" });
            kitBrowserAfterMenu.current = true;
            onChoose?.();
          }}
          data-testid="sidebar-create-from-kit"
          className="h-auto items-start py-2"
        >
          <DataEnrichmentAdd
            size={16}
            className="mt-0.5 shrink-0"
            aria-hidden
          />
          <MenuItemText
            label="From a starter kit"
            caption="Pick one built for a job"
          />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
