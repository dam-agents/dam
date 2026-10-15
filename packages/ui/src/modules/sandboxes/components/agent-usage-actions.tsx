import { Chat, Code, Terminal } from "@carbon/icons-react";
import { SessionMode } from "api-server-api";
import { useState } from "react";

import { getBrand } from "@/brand";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useAgents } from "../../agents/api/queries.js";
import { ConnectionIcon } from "../../connections/components/connection-icon.js";
import { type Action, ActionList } from "./action-list.js";
import {
  type BindMessenger,
  ChannelBindModal,
} from "./channels/channel-bind-modal.js";
import { OpenInIdeDialog, OpenInTerminalDialog } from "./open-in-dialogs.js";

export function AgentUsageActions({ agent }: { agent: AgentView }) {
  const selectAgent = useStore((s) => s.selectAgent);
  const openAgentSession = useStore((s) => s.openAgentSession);
  const available = useAgents().data?.availableChannels ?? {};
  const [dialog, setDialog] = useState<"cli" | "ssh" | null>(null);
  const [messenger, setMessenger] = useState<BindMessenger | null>(null);
  const cli = getBrand().short;

  const actions: Action[] = [
    {
      title: "Web chat",
      description: "Chat with the agent in this browser.",
      icon: <Chat />,
      label: "Open chat",
      onClick: () => selectAgent(agent.id),
    },
    {
      title: "Web terminal",
      description: "Run an interactive shell on the agent in this browser.",
      icon: <Terminal />,
      label: "Open terminal",
      onClick: () =>
        openAgentSession(agent.id, crypto.randomUUID(), SessionMode.Terminal),
    },
    {
      title: "CLI",
      description: (
        <>
          <code className="font-mono">{cli} chat</code> connects your terminal
          to the agent.
        </>
      ),
      icon: <Terminal />,
      label: "Show command",
      onClick: () => setDialog("cli"),
    },
    {
      title: "SSH",
      description: "Open the agent's workspace in VS Code or Zed over SSH.",
      icon: <Code />,
      label: "Show commands",
      onClick: () => setDialog("ssh"),
    },
    ...(available.slack
      ? [
          {
            title: "Slack",
            description: "Mention the agent in a Slack channel or DM it.",
            icon: <ConnectionIcon iconSlug="slack" alt="" size={16} />,
            label: "Add to Slack",
            onClick: () => setMessenger("slack"),
          },
        ]
      : []),
    ...(available.telegram
      ? [
          {
            title: "Telegram",
            description: "Message the agent from a Telegram chat.",
            icon: <ConnectionIcon iconSlug="telegram" alt="" size={16} />,
            label: "Add to Telegram",
            onClick: () => setMessenger("telegram"),
          },
        ]
      : []),
  ];

  return (
    <>
      <ActionList label="Use" actions={actions} />
      {dialog === "cli" && (
        <OpenInTerminalDialog
          agentId={agent.id}
          agentName={agent.name}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "ssh" && (
        <OpenInIdeDialog
          agentId={agent.id}
          agentName={agent.name}
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
