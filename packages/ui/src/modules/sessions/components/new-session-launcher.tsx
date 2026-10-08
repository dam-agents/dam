import { Code, Terminal } from "@carbon/icons-react";
import { type ReactNode, useState } from "react";

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

type LocalTarget = "terminal" | "ide";

export function NewSessionLauncher({
  agentId,
  agentName,
  onNewTerminal,
}: {
  agentId: string;
  agentName: string;
  onNewTerminal: () => void;
}) {
  const [dialog, setDialog] = useState<LocalTarget | null>(null);
  const [messenger, setMessenger] = useState<BindMessenger | null>(null);
  const available = useAgents().data?.availableChannels ?? {};

  return (
    <>
      <div className="mt-5 grid w-full max-w-[640px] grid-cols-1 gap-3 sm:grid-cols-2">
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
          onClick={() => setDialog("terminal")}
        />
        <LauncherTile
          icon={<Code size={18} />}
          title="VS Code / Zed"
          description="Open workspace in your local editor"
          onClick={() => setDialog("ide")}
        />
        {available.slack && (
          <LauncherTile
            icon={<ConnectionIcon iconSlug="slack" alt="" size={18} />}
            title="Slack Channel"
            description="Mention the agent in a connected channel"
            onClick={() => setMessenger("slack")}
          />
        )}
      </div>

      {dialog === "terminal" && (
        <OpenInTerminalDialog
          agentId={agentId}
          agentName={agentName}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "ide" && (
        <OpenInIdeDialog
          agentId={agentId}
          agentName={agentName}
          onClose={() => setDialog(null)}
        />
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
