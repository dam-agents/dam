import { Chat, Terminal } from "@carbon/icons-react";
import { SessionMode } from "api-server-api";
import { useState } from "react";

import { getBrand } from "@/brand";
import { CopyableCommand } from "@/components/copyable-command";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useAgents } from "../../agents/api/queries.js";
import { ConnectionIcon } from "../../connections/components/connection-icon.js";
import { type Action, ActionList } from "./action-list.js";
import {
  type BindMessenger,
  ChannelBindModal,
} from "./channels/channel-bind-modal.js";
import { CliQuickstartNote } from "./open-in-dialogs.js";

export function AgentUsageActions({ agent }: { agent: AgentView }) {
  const selectAgent = useStore((s) => s.selectAgent);
  const openAgentSession = useStore((s) => s.openAgentSession);
  const available = useAgents().data?.availableChannels ?? {};
  const [messenger, setMessenger] = useState<BindMessenger | null>(null);
  const cli = getBrand().short;

  const actions: Action[] = [
    {
      title: "Web chat",
      description: "Chat with the agent in this browser.",
      button: {
        icon: <Chat />,
        label: "Open chat",
        onClick: () => selectAgent(agent.id),
      },
    },
    {
      title: "Web terminal",
      description: "Run an interactive shell on the agent in this browser.",
      button: {
        icon: <Terminal />,
        label: "Open terminal",
        onClick: () =>
          openAgentSession(agent.id, crypto.randomUUID(), SessionMode.Terminal),
      },
    },
    {
      title: "CLI",
      description: (
        <>
          <code className="font-mono">{cli} chat</code> connects your terminal
          to the agent.
        </>
      ),
      content: (
        <div className="flex flex-col gap-2">
          <CopyableCommand command={`${cli} chat ${agent.id}`} />
          <CliQuickstartNote />
        </div>
      ),
    },
    {
      title: "SSH",
      description: "Open the agent's workspace in VS Code or Zed over SSH.",
      content: (
        <div className="flex flex-col gap-2">
          <CopyableCommand command={`${cli} ssh connect -x code ${agent.id}`} />
          <CopyableCommand command={`${cli} ssh connect -x zed ${agent.id}`} />
        </div>
      ),
    },
    ...(available.slack
      ? [
          {
            title: "Slack",
            description: "Mention the agent in a Slack channel or DM it.",
            button: {
              icon: <ConnectionIcon iconSlug="slack" alt="" size={16} />,
              label: "Add to Slack",
              onClick: () => setMessenger("slack"),
            },
          },
        ]
      : []),
    ...(available.telegram
      ? [
          {
            title: "Telegram",
            description: "Message the agent from a Telegram chat.",
            button: {
              icon: <ConnectionIcon iconSlug="telegram" alt="" size={16} />,
              label: "Add to Telegram",
              onClick: () => setMessenger("telegram"),
            },
          },
        ]
      : []),
  ];

  return (
    <>
      <ActionList actions={actions} />
      {messenger && (
        <ChannelBindModal
          messengers={[messenger]}
          onClose={() => setMessenger(null)}
        />
      )}
    </>
  );
}
