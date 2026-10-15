import { Code, Terminal } from "@carbon/icons-react";
import { type ComponentProps, type ReactNode, useState } from "react";

import { PromptIcon } from "@/components/brand-icons";

import { useAgents } from "../../agents/api/queries.js";
import { ConnectionIcon } from "../../connections/components/connection-icon.js";
import {
  type BindMessenger,
  ChannelBindModal,
} from "../../sandboxes/components/channels/channel-bind-modal.js";
import {
  OpenInIdeDialog,
  OpenInTerminalDialog,
} from "../../sandboxes/components/open-in-dialogs.js";
import { TerminalHarnessButtons } from "./terminal-harness-buttons.js";

type LocalTarget = "terminal" | "ide";

export function NewSessionLauncher({
  agentId,
  onNewTerminal,
}: {
  agentId: string;
  onNewTerminal: () => void;
}) {
  const [dialog, setDialog] = useState<LocalTarget | null>(null);
  const [messenger, setMessenger] = useState<BindMessenger | null>(null);
  const available = useAgents().data?.availableChannels ?? {};

  return (
    <>
      <div className="mt-5 grid w-full max-w-[640px] grid-cols-1 gap-3 @md/chat:grid-cols-2">
        <div className="flex flex-col items-start gap-3 rounded-lg border border-border bg-background p-4 text-left">
          <div className="flex w-full items-start justify-between gap-2">
            <TileIcon>
              <Terminal size={18} />
            </TileIcon>
            <TerminalHarnessButtons
              agentId={agentId}
              onOpen={onNewTerminal}
              className="flex-wrap justify-end"
            />
          </div>
          <TileText
            title="Web terminal"
            description="Terminal UI session right here"
          />
        </div>
        <LauncherTile
          icon={<PromptIcon width={18} height={18} />}
          title="CLI and SSH"
          description="Terminal UI session in your own terminal"
          onClick={() => setDialog("terminal")}
        />
        <LauncherTile
          icon={<Code size={18} />}
          title="VS Code / Zed"
          description="Editor session inside the agent's sandbox"
          onClick={() => setDialog("ide")}
        />
        {available.slack && (
          <LauncherTile
            icon={<ConnectionIcon iconSlug="slack" alt="" size={18} />}
            title="Slack channel"
            description="Mention the agent in a connected channel"
            onClick={() => setMessenger("slack")}
          />
        )}
      </div>

      {dialog === "terminal" && (
        <OpenInTerminalDialog
          agentId={agentId}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "ide" && (
        <OpenInIdeDialog agentId={agentId} onClose={() => setDialog(null)} />
      )}
      {messenger && (
        <ChannelBindModal
          messengers={[messenger]}
          onClose={() => setMessenger(null)}
        />
      )}
    </>
  );
}

function LauncherTile({
  icon,
  title,
  description,
  ...props
}: {
  icon: ReactNode;
  title: string;
  description: string;
} & ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...props}
      className="flex flex-col items-start gap-3 rounded-lg border border-border bg-background p-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
    >
      <TileIcon>{icon}</TileIcon>
      <TileText title={title} description={description} />
    </button>
  );
}

function TileIcon({ children }: { children: ReactNode }) {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border text-foreground">
      {children}
    </span>
  );
}

function TileText({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <span className="min-w-0">
      <span className="block text-sm font-medium text-foreground">{title}</span>
      <span className="mt-0.5 block text-sm text-muted-foreground">
        {description}
      </span>
    </span>
  );
}
