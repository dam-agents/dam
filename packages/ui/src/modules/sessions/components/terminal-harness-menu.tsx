import { Information } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { HarnessIcons } from "@/components/harness-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { menuItemVariants } from "@/components/ui/menu-styles";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { useHarnessConfigStatus } from "../../agents/api/harness-config.js";
import {
  useHarnessCatalog,
  useProviderConnections,
} from "../api/session-pair.js";
import {
  harnessDisplayName,
  providerOptions,
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
  const { granted, owned } = useProviderConnections(agentId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {harnesses.length === 0 ? (
          <DropdownMenuItem onSelect={onOpen}>Default harness</DropdownMenuItem>
        ) : (
          harnesses.map(({ name }) => {
            const fit = providerOptions(name, catalog ?? [], granted, owned);
            const provider = fit.granted[0]?.id;
            const displayName = harnessDisplayName(name, catalog) ?? name;
            const label = (
              <>
                <HarnessIcons harnesses={[name]} size="xs" />
                {displayName}
              </>
            );
            return provider === undefined ? (
              <div
                key={name}
                aria-disabled
                className={cn(menuItemVariants(), "cursor-default")}
              >
                <span className="flex items-center gap-2 opacity-50">
                  {label}
                </span>
                <Tooltip
                  content={
                    fit.addable.length === 0
                      ? "This harness does not support any of the LLM providers you have configured."
                      : "Grant this agent a provider this harness supports on its Providers page."
                  }
                >
                  <span
                    tabIndex={0}
                    aria-label={`Why ${displayName} is unavailable`}
                    className="ml-auto pl-4 text-muted-foreground"
                  >
                    <Information size={14} />
                  </span>
                </Tooltip>
              </div>
            ) : (
              <DropdownMenuItem
                key={name}
                onSelect={() => {
                  setNextSessionPair(agentId, {
                    harness: name,
                    provider,
                    model: null,
                  });
                  onOpen();
                }}
              >
                {label}
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
