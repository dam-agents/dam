import { Slot } from "@radix-ui/react-slot";
import type { SessionPair } from "api-server-api";
import type { ReactElement } from "react";

import { HarnessIcons } from "@/components/harness-icons";
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
  type TerminalHarness,
  terminalHarnessChoice,
} from "../lib/session-pair-options.js";
import { useAttachProvidersDialog } from "./attach-providers-dialog.js";

// UNIT_BOUNDARY_DESCRIPTION: the button it wraps opens a menu of the harnesses a new web terminal can start with. Picking one stores it as the agent's next terminal pair, which the terminal hands the runtime on connect: the harness, with no model and no settings, so the harness starts on its own default model, and with the first attached provider it accepts, which a runtime from before the Model Router needs. The chat picker's pair is neither read nor changed. A harness whose fitting providers the owner holds but has not attached asks which to attach first. When the harnesses cannot be read or the agent names none, the button opens a plain terminal on the runtime's default harness.
export function TerminalHarnessMenu({
  agentId,
  onOpen,
  children,
}: {
  agentId: string;
  onOpen: () => void;
  children: ReactElement;
}) {
  const setNextTerminalPair = useStore((s) => s.setNextTerminalPair);
  const status = useHarnessConfigStatus(agentId);
  const catalogQuery = useHarnessCatalog();
  const { granted, owned, loaded, failed } = useProviderConnections(agentId);
  const attach = useAttachProvidersDialog(agentId);
  const choice = terminalHarnessChoice({
    loading: status.isPending || catalogQuery.isPending || (!loaded && !failed),
    failed: failed || status.isError || catalogQuery.isError,
    carried: (status.data?.harnesses ?? []).map((h) => h.name),
    catalog: catalogQuery.data?.harnesses,
    granted,
    owned,
  });
  const start = (pair: SessionPair | null) => {
    setNextTerminalPair(agentId, pair);
    onOpen();
  };
  const pick = async ({ name, provider, attachable }: TerminalHarness) => {
    const chosen = provider ?? (await attach.ask(name, attachable))?.[0];
    if (chosen) start({ harness: name, provider: chosen, model: null });
  };

  if (choice.kind === "fallback")
    return <Slot onClick={() => start(null)}>{children}</Slot>;
  return (
    <>
      {attach.dialog}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-w-72">
          {choice.kind === "loading" ? (
            <DropdownMenuItem disabled>Loading harnesses…</DropdownMenuItem>
          ) : choice.harnesses.length === 0 ? (
            <DropdownMenuItem disabled className="h-auto py-2">
              No harness supports the LLM providers you have configured.
            </DropdownMenuItem>
          ) : (
            choice.harnesses.map((harness) => (
              <DropdownMenuItem
                key={harness.name}
                className="text-muted-foreground"
                onSelect={() => void pick(harness)}
              >
                <span aria-hidden>
                  <HarnessIcons harnesses={[harness.name]} size="xs" />
                </span>
                {harness.displayName}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
