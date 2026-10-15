import type { ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { useStore } from "../../../store.js";
import { useHarnessConfigStatus } from "../../agents/api/harness-config.js";
import {
  useHarnessCatalog,
  useProviderConnections,
} from "../api/session-pair.js";
import {
  fittingProviders,
  harnessDisplayName,
} from "../lib/session-pair-options.js";

// UNIT_BOUNDARY_DESCRIPTION: the harness list a new web terminal starts with. Picking one makes it the agent's next session pair, which the terminal hands the runtime on connect; a harness with no granted provider that fits it cannot start, so it is disabled.
export function TerminalHarnessMenu({
  agentId,
  onOpen,
  children,
}: {
  agentId: string;
  onOpen: () => void;
  children: ReactNode;
}) {
  const setNextSessionPair = useStore((s) => s.setNextSessionPair);
  const harnesses = useHarnessConfigStatus(agentId).data?.harnesses ?? [];
  const catalog = useHarnessCatalog().data?.harnesses;
  const { granted } = useProviderConnections(agentId);
  const fitting = fittingProviders(catalog ?? [], granted);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {harnesses.length === 0 ? (
          <DropdownMenuItem onSelect={onOpen}>Default harness</DropdownMenuItem>
        ) : (
          harnesses.map(({ name }) => {
            const provider = fitting(name)[0];
            return (
              <DropdownMenuItem
                key={name}
                disabled={provider === undefined}
                onSelect={() => {
                  setNextSessionPair(agentId, {
                    harness: name,
                    provider: provider!,
                    model: null,
                  });
                  onOpen();
                }}
              >
                {harnessDisplayName(name, catalog) ?? name}
                {provider === undefined && (
                  <span className="ml-auto pl-4 text-xs text-muted-foreground">
                    No provider
                  </span>
                )}
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
