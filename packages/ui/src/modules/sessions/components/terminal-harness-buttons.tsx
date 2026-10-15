import { Terminal } from "@carbon/icons-react";

import { HarnessIcons } from "@/components/harness-icons";
import { Button } from "@/components/ui/button";
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

// UNIT_BOUNDARY_DESCRIPTION: one button per harness a new web terminal can start with. Opening one makes it the agent's next session pair, which the terminal hands the runtime on connect; a harness with no granted provider that fits it cannot start, so its button is greyed and its tooltip says why.
export function TerminalHarnessButtons({
  agentId,
  onOpen,
  className,
}: {
  agentId: string;
  onOpen: () => void;
  className?: string;
}) {
  const setNextSessionPair = useStore((s) => s.setNextSessionPair);
  const status = useHarnessConfigStatus(agentId);
  const catalogQuery = useHarnessCatalog();
  const catalog = catalogQuery.data?.harnesses;
  const { granted, owned, loaded, failed } = useProviderConnections(agentId);
  const harnesses = status.data?.harnesses ?? [];

  if (status.isPending || catalogQuery.isPending || (!loaded && !failed))
    return null;
  if (harnesses.length === 0 || !catalog || failed)
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Open a terminal"
        tooltip="Open a terminal"
        onClick={onOpen}
      >
        <Terminal size={16} />
      </Button>
    );
  return (
    <span className={cn("flex items-center gap-1", className)}>
      {harnesses.map(({ name }) => {
        const fit = providerOptions(name, catalog, granted, owned);
        const provider = fit.granted[0]?.id;
        const displayName = harnessDisplayName(name, catalog) ?? name;
        const unavailable =
          provider !== undefined
            ? null
            : fit.addable.length === 0
              ? `${displayName} does not support any of the LLM providers you have configured.`
              : `Grant this agent a provider ${displayName} supports on its Providers page.`;
        return (
          <Button
            key={name}
            variant="ghost"
            size="icon"
            aria-label={
              unavailable
                ? `${displayName}: ${unavailable}`
                : `Open a ${displayName} terminal`
            }
            aria-disabled={unavailable !== null}
            tooltip={unavailable ?? displayName}
            className={cn(
              "size-9 [&_[role=img]]:size-5",
              unavailable && "cursor-default opacity-25",
            )}
            onClick={() => {
              if (provider === undefined) return;
              setNextSessionPair(agentId, {
                harness: name,
                provider,
                model: null,
              });
              onOpen();
            }}
          >
            <HarnessIcons harnesses={[name]} size="xs" />
          </Button>
        );
      })}
    </span>
  );
}
