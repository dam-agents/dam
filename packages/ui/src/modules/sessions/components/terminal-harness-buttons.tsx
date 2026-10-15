import { Terminal } from "@carbon/icons-react";

import { HarnessIcons } from "@/components/harness-icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { useHarnessConfigStatus } from "../../agents/api/harness-config.js";
import {
  useGrantProvider,
  useHarnessCatalog,
  useProviderConnections,
} from "../api/session-pair.js";
import { terminalHarnessChoice } from "../lib/session-pair-options.js";

// UNIT_BOUNDARY_DESCRIPTION: one button per harness a new web terminal can start with. Opening one makes it the agent's next session pair, which the terminal hands the runtime on connect; a harness whose fitting provider the owner holds but has not granted attaches it first, after asking; a harness that cannot start is greyed and its tooltip says why.
export function TerminalHarnessButtons({
  agentId,
  onOpen,
}: {
  agentId: string;
  onOpen: () => void;
}) {
  const setNextSessionPair = useStore((s) => s.setNextSessionPair);
  const status = useHarnessConfigStatus(agentId);
  const catalogQuery = useHarnessCatalog();
  const { granted, owned, loaded, failed } = useProviderConnections(agentId);
  const grants = useGrantProvider(agentId);
  const choice = terminalHarnessChoice({
    loading: status.isPending || catalogQuery.isPending || (!loaded && !failed),
    failed: failed || status.isError || catalogQuery.isError,
    carried: (status.data?.harnesses ?? []).map((h) => h.name),
    catalog: catalogQuery.data?.harnesses,
    granted,
    owned,
  });

  if (choice.kind === "loading") return null;
  if (choice.kind === "fallback")
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
    <span className="flex items-center gap-1">
      {choice.harnesses.map(
        ({ name, displayName, provider, attach, unavailable }) => (
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
            tooltip={
              unavailable ??
              (attach
                ? `${displayName}, after attaching ${attach.name}`
                : displayName)
            }
            className={cn(
              "size-9 [&_[role=img]]:size-5",
              unavailable && "cursor-default opacity-25",
            )}
            onClick={async () => {
              const chosen = provider ?? attach?.id;
              if (!chosen || (attach && !(await grants.attach(attach)))) return;
              setNextSessionPair(agentId, {
                harness: name,
                provider: chosen,
                model: null,
              });
              onOpen();
            }}
          >
            <HarnessIcons harnesses={[name]} size="xs" />
          </Button>
        ),
      )}
    </span>
  );
}
