import { Code, Terminal } from "@carbon/icons-react";
import { type ReactNode, useState } from "react";

import { getBrand } from "@/brand";
import { CopyableCommand } from "@/components/copyable-command";
import { DialogBody, DialogHeader, Modal } from "@/components/modal";

import type { AgentView } from "../../../types.js";
import { useAgents } from "../../agents/api/queries.js";
import { ConnectionIcon } from "../../connections/components/connection-icon.js";
import { MessengerBindDialog } from "../../sandboxes/components/channels/messenger-bind-dialog.js";
import type { BindMessenger } from "../../sandboxes/components/channels/messenger-instructions.js";
import { cliAgentRef } from "../../sandboxes/lib/cli-agent-ref.js";

type LocalTarget = "terminal" | "ide";

// UNIT_BOUNDARY_DESCRIPTION: the cards an empty chat offers for starting a session somewhere other than this chat: a web terminal here, the agent from a local terminal or editor, or a Slack channel or Telegram chat. The local ones show the CLI command to copy; the messengers show how to bind the agent.
export function NewSessionLauncher({
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

  return (
    <>
      <div
        className="mt-5 grid w-full max-w-[640px] grid-cols-1 gap-3 sm:grid-cols-2"
        data-testid="new-session-launcher"
      >
        <LauncherTile
          icon={<Terminal size={18} />}
          title="Browser Terminal"
          description="Interactive session in this tab"
          onClick={onNewTerminal}
        />
        <LauncherTile
          icon={<Terminal size={18} />}
          title="Local Terminal"
          description="SSH into the agent from your machine"
          onClick={() => setLocal("terminal")}
        />
        <LauncherTile
          icon={<Code size={18} />}
          title="VS Code / Zed"
          description="Open workspace in your local editor"
          onClick={() => setLocal("ide")}
        />
        {available.slack && (
          <LauncherTile
            icon={<ConnectionIcon iconSlug="slack" alt="" size={18} />}
            title="Slack Channel"
            description="Mention the agent in a connected channel"
            onClick={() => setMessenger("slack")}
          />
        )}
        {available.telegram && (
          <LauncherTile
            icon={<ConnectionIcon iconSlug="telegram" alt="" size={18} />}
            title="Telegram Chat"
            description="Message the agent from a Telegram chat"
            onClick={() => setMessenger("telegram")}
          />
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
  return (
    <Modal size="sm" onClose={onClose}>
      <DialogHeader
        title={
          target === "terminal" ? "Open in Terminal" : "Open in VS Code / Zed"
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

function LauncherTile({
  icon,
  title,
  description,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-start gap-3 rounded-lg border border-border bg-background p-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex size-9 items-center justify-center rounded-md border border-border text-foreground">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">
          {title}
        </span>
        <span className="mt-0.5 block text-sm text-muted-foreground">
          {description}
        </span>
      </span>
    </button>
  );
}
