import { Code, Terminal } from "@carbon/icons-react";
import { useState } from "react";

import { getBrand } from "@/brand";
import { SlackColorIcon, TelegramColorIcon } from "@/components/brand-icons";
import { CopyableCommand } from "@/components/copyable-command";
import { DialogBody, DialogHeader, Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { externalLinkProps } from "@/lib/external-link";

import type { AgentView } from "../../../types.js";
import { useAgents } from "../../agents/api/queries.js";
import { holds } from "../../agents/lib/agent-permissions.js";
import { useDocsUrl } from "../../links/api/queries.js";
import { MessengerBindDialog } from "../../sandboxes/components/channels/messenger-bind-dialog.js";
import type { BindMessenger } from "../../sandboxes/components/channels/messenger-instructions.js";
import { cliAgentRef } from "../../sandboxes/lib/cli-agent-ref.js";
import { TerminalHarnessMenu } from "./terminal-harness-menu.js";

type LocalTarget = "terminal" | "ide";

// UNIT_BOUNDARY_DESCRIPTION: the quiet row an empty chat offers for starting a session somewhere other than this chat: a web terminal here, the agent from a local terminal or editor, or a Slack channel or Telegram chat. The local ones show the CLI command to copy; the messengers show how to bind the agent. Each shows only to a person who holds the Agent Permission it needs: terminal for the terminals and editors, channels for the messengers.
export function NewSessionOptions({
  agent,
  onNewTerminal,
}: {
  agent: AgentView;
  onNewTerminal: () => void;
}) {
  const [local, setLocal] = useState<LocalTarget | null>(null);
  const [messenger, setMessenger] = useState<BindMessenger | null>(null);
  const agentsData = useAgents().data;
  const available = agentsData?.availableChannels ?? {};
  const ref = cliAgentRef(agent, agentsData?.list ?? [agent]);
  const terminal = holds(agent.access, "terminal");
  const channels = holds(agent.access, "channels");
  if (!terminal && !(channels && (available.slack || available.telegram)))
    return null;

  return (
    <>
      <div
        className="mt-5 flex w-full max-w-[640px] flex-wrap items-center justify-center gap-1 text-sm"
        data-testid="new-session-launcher"
      >
        <span className="px-1 text-muted-foreground">Also open in:</span>
        {terminal && (
          <>
            <TerminalHarnessMenu agentId={agent.id} onOpen={onNewTerminal}>
              <Button variant="ghost" size="sm">
                <Terminal size={16} />
                Web terminal
              </Button>
            </TerminalHarnessMenu>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocal("terminal")}
            >
              <Terminal size={16} />
              CLI and SSH
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setLocal("ide")}>
              <Code size={16} />
              VS Code and Zed
            </Button>
          </>
        )}
        {channels && available.slack && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMessenger("slack")}
          >
            <SlackColorIcon aria-hidden width={16} height={16} />
            Slack
          </Button>
        )}
        {channels && available.telegram && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMessenger("telegram")}
          >
            <TelegramColorIcon aria-hidden width={16} height={16} />
            Telegram
          </Button>
        )}
      </div>
      {local && (
        <LocalCommandDialog
          target={local}
          agentName={agent.name}
          agentRef={ref}
          onClose={() => setLocal(null)}
        />
      )}
      {messenger && (
        <MessengerBindDialog
          messenger={messenger}
          onClose={() => setMessenger(null)}
        />
      )}
    </>
  );
}

function LocalCommandDialog({
  target,
  agentName,
  agentRef,
  onClose,
}: {
  target: LocalTarget;
  agentName: string;
  agentRef: string;
  onClose: () => void;
}) {
  const cli = getBrand().short;
  const brand = getBrand();
  const cliReferenceUrl = useDocsUrl("cliReference");
  return (
    <Modal size="sm" onClose={onClose}>
      <DialogHeader
        title={
          target === "terminal" ? "Open in Terminal" : "Open in VS Code or Zed"
        }
        onClose={onClose}
        subtitle={
          target === "terminal" ? (
            <>
              <code className="font-mono">{cli} chat</code> connects your
              terminal to{" "}
              <strong className="text-foreground">{agentName}</strong>
              's interactive TUI;{" "}
              <code className="font-mono">{cli} ssh connect</code> opens a
              shell.
            </>
          ) : (
            <>
              <code className="font-mono">{cli} ssh connect</code> launches your
              editor against{" "}
              <strong className="text-foreground">{agentName}</strong>'s
              workspace over SSH.
            </>
          )
        }
      />
      <DialogBody className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          {cliReferenceUrl ? (
            <>
              Follow the{" "}
              <a
                href={cliReferenceUrl}
                {...externalLinkProps}
                className="font-medium text-foreground hover:underline"
              >
                CLI quickstart
              </a>{" "}
              to install the {brand.name} CLI and log in.
            </>
          ) : (
            <>Install the {brand.name} CLI and log in.</>
          )}
        </p>
        {target === "terminal" ? (
          <>
            <span className="text-sm font-medium text-foreground">
              Open the agent TUI
            </span>
            <CopyableCommand command={`${cli} chat ${agentRef}`} />
            <span className="mt-1 text-sm font-medium text-foreground">
              SSH to the agent
            </span>
            <CopyableCommand command={`${cli} ssh connect ${agentRef}`} />
          </>
        ) : (
          <>
            <span className="text-sm font-medium text-foreground">
              Open in VS Code
            </span>
            <CopyableCommand
              command={`${cli} ssh connect -x code ${agentRef}`}
            />
            <span className="mt-1 text-sm font-medium text-foreground">
              Open in Zed
            </span>
            <CopyableCommand
              command={`${cli} ssh connect -x zed ${agentRef}`}
            />
          </>
        )}
      </DialogBody>
    </Modal>
  );
}
