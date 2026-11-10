import { Terminal } from "@carbon/icons-react";
import { type ReactElement, useRef } from "react";
import { match } from "ts-pattern";

import { HarnessIcons } from "@/components/harness-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import type { TerminalLaunch } from "../lib/terminal-launch.js";
import { useAttachProvidersDialog } from "./attach-providers-dialog.js";

type MenuPick =
  | { kind: "harness"; harness: TerminalHarness }
  | { kind: "default" }
  | { kind: "shell" };

// UNIT_BOUNDARY_DESCRIPTION: the button it wraps opens a menu of what a new web terminal can start. Picking a harness stores it as the agent's next terminal launch, which the terminal hands the runtime on connect: the harness, with no model and no settings, so the harness starts on its own default model, and with the first attached provider it accepts, which a runtime from before the Model Router needs. The chat picker's pair is neither read nor changed. A harness whose fitting providers the owner holds but has not attached asks which to attach first. Shell is offered on every agent, whatever its harnesses and providers and while they load: it starts the agent user's login shell, which needs no harness, provider or model. A pick runs only once the menu has closed and given focus back to the button, so the attach dialog gives focus back to the button too, not to a menu item that is gone. When the harnesses cannot be read or the agent names none, the menu offers the runtime's default harness in their place.
export function TerminalHarnessMenu({
  agentId,
  onOpen,
  children,
}: {
  agentId: string;
  onOpen: () => void;
  children: ReactElement;
}) {
  const setNextTerminalLaunch = useStore((s) => s.setNextTerminalLaunch);
  const status = useHarnessConfigStatus(agentId);
  const catalogQuery = useHarnessCatalog();
  const { granted, owned, loaded, failed } = useProviderConnections(agentId);
  const attach = useAttachProvidersDialog(agentId);
  const picked = useRef<MenuPick | null>(null);
  const choice = terminalHarnessChoice({
    loading: status.isPending || catalogQuery.isPending || (!loaded && !failed),
    failed: failed || status.isError || catalogQuery.isError,
    carried: (status.data?.harnesses ?? []).map((h) => h.name),
    catalog: catalogQuery.data?.harnesses,
    granted,
    owned,
  });
  const start = (launch: TerminalLaunch | null) => {
    setNextTerminalLaunch(agentId, launch);
    onOpen();
  };
  const startHarness = async ({
    name,
    provider,
    attachable,
  }: TerminalHarness) => {
    const chosen = provider ?? (await attach.ask(name, attachable))?.[0];
    if (chosen)
      start({
        kind: "harness",
        pair: { harness: name, provider: chosen, model: null },
      });
  };
  const run = (pick: MenuPick) =>
    match(pick)
      .with({ kind: "harness" }, ({ harness }) => void startHarness(harness))
      .with({ kind: "default" }, () => start(null))
      .with({ kind: "shell" }, () => start({ kind: "shell" }))
      .exhaustive();
  const choose = (pick: MenuPick) => () => {
    picked.current = pick;
  };

  return (
    <>
      {attach.dialog}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-w-72"
          onCloseAutoFocus={() => {
            const pick = picked.current;
            picked.current = null;
            if (pick) run(pick);
          }}
        >
          {match(choice)
            .with({ kind: "loading" }, () => (
              <DropdownMenuItem disabled>Loading harnesses…</DropdownMenuItem>
            ))
            .with({ kind: "fallback" }, () => (
              <DropdownMenuItem
                className="text-muted-foreground"
                onSelect={choose({ kind: "default" })}
              >
                Default harness
              </DropdownMenuItem>
            ))
            .with({ kind: "harnesses" }, ({ harnesses }) =>
              harnesses.length === 0 ? (
                <DropdownMenuItem disabled className="h-auto py-2">
                  No harness supports the LLM providers you have configured.
                </DropdownMenuItem>
              ) : (
                harnesses.map((harness) => (
                  <DropdownMenuItem
                    key={harness.name}
                    className="text-muted-foreground"
                    onSelect={choose({ kind: "harness", harness })}
                  >
                    <span aria-hidden>
                      <HarnessIcons harnesses={[harness.name]} size="xs" />
                    </span>
                    {harness.displayName}
                  </DropdownMenuItem>
                ))
              ),
            )
            .exhaustive()}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-muted-foreground"
            onSelect={choose({ kind: "shell" })}
          >
            <Terminal size={14} aria-hidden />
            Shell
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
