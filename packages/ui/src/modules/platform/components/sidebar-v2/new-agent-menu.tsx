import type { ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { useStore } from "../../../../store.js";
import { useCreateDefaultAgent } from "../../../agents/hooks/use-create-default-agent.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: both layouts' New agent control asks the same question rather than creating at once, so an Agent built from a starter kit is as near as one built from nothing: the menu offers the generalist Agent the button used to make on its own, or the starter kits to build one from. It is the trigger that differs — a row of the tree, a tile of the rail.
 */
export function NewAgentMenu({
  side = "bottom",
  onNavigate,
  children,
}: {
  side?: "bottom" | "right";
  onNavigate?: () => void;
  children: ReactNode;
}) {
  const defaultAgent = useCreateDefaultAgent();
  const setKitBrowserOpen = useStore((s) => s.setKitBrowserOpen);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent side={side} align="start" className="w-60">
        <DropdownMenuItem
          data-testid="new-generalist-agent"
          disabled={!defaultAgent.ready}
          onSelect={() => {
            onNavigate?.();
            void defaultAgent.create();
          }}
        >
          New generalist agent
        </DropdownMenuItem>
        <DropdownMenuItem
          data-testid="new-agent-from-kit"
          onSelect={() => {
            onNavigate?.();
            setKitBrowserOpen(true);
          }}
        >
          New from a starter kit
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
