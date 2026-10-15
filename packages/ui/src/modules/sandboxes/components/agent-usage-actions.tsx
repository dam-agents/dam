import { Chat, Launch, LogoSlack, Terminal } from "@carbon/icons-react";
import { SessionMode } from "api-server-api";
import type { ReactNode } from "react";

import { getBrand } from "@/brand";
import { PromptIcon, TelegramIcon } from "@/components/brand-icons";
import { CopyableCommand } from "@/components/copyable-command";
import { externalLinkProps } from "@/lib/external-link";

import { CLI_REFERENCE_URL } from "../../../constants.js";
import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useAgents } from "../../agents/api/queries.js";
import { useSlackInstallRequestUrl } from "../../links/api/queries.js";
import { TerminalHarnessButtons } from "../../sessions/components/terminal-harness-buttons.js";
import { SlackInstallRequest } from "../../slack/components/slack-install-request.js";
import { type Action, ActionList } from "./action-list.js";
import { MessengerInstructions } from "./channels/messenger-instructions.js";

const VS_CODE_REMOTE_URL = "https://code.visualstudio.com/docs/remote/ssh";
const ZED_REMOTE_URL = "https://zed.dev/docs/remote-development";

function DocLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      {...externalLinkProps}
      className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
    >
      {children} <Launch size={13} />
    </a>
  );
}

export function AgentUsageActions({
  agent,
  showChat = true,
  onNewTerminal,
}: {
  agent: AgentView;
  showChat?: boolean;
  onNewTerminal?: () => void;
}) {
  const selectAgent = useStore((s) => s.selectAgent);
  const openAgentSession = useStore((s) => s.openAgentSession);
  const available = useAgents().data?.availableChannels ?? {};
  const slackInstallUrl = useSlackInstallRequestUrl();
  const brand = getBrand();

  const actions: Action[] = [
    ...(showChat
      ? [
          {
            icon: <Chat />,
            kind: "link" as const,
            title: "Chat",
            description: "Chat with the agent in this browser.",
            onClick: () => selectAgent(agent.id),
          },
        ]
      : []),
    {
      icon: <Terminal />,
      kind: "control",
      title: "Web terminal",
      description: "Open the harnesses' terminal UI in this browser.",
      control: (
        <TerminalHarnessButtons
          agentId={agent.id}
          onOpen={
            onNewTerminal ??
            (() =>
              openAgentSession(
                agent.id,
                crypto.randomUUID(),
                SessionMode.Terminal,
                true,
              ))
          }
        />
      ),
    },
    {
      icon: <PromptIcon />,
      kind: "expand",
      title: "CLI and SSH",
      description:
        "Use the agent from your own terminal, over SSH, or in your editor.",
      content: (
        <div className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>
            Follow the{" "}
            <DocLink href={CLI_REFERENCE_URL}>CLI quickstart</DocLink> to
            install the {brand.name} CLI and log in.
          </p>
          <p className="mt-1">Open the agent TUI in your terminal:</p>
          <CopyableCommand command={`${brand.short} chat ${agent.id}`} />
          <p className="mt-1">SSH to the agent:</p>
          <CopyableCommand command={`${brand.short} ssh connect ${agent.id}`} />
          <p className="mt-1">
            Open a remote <DocLink href={VS_CODE_REMOTE_URL}>VS Code</DocLink>{" "}
            (or <DocLink href={ZED_REMOTE_URL}>Zed</DocLink> with{" "}
            <code className="font-mono">-x zed</code>) session and work directly
            in the agent's sandbox:
          </p>
          <CopyableCommand
            command={`${brand.short} ssh connect -x code ${agent.id}`}
          />
        </div>
      ),
    },
    ...(available.slack
      ? [
          {
            icon: <LogoSlack />,
            kind: "expand" as const,
            title: "Slack",
            description: "Mention the agent in a Slack channel or DM it.",
            content: (
              <div className="flex flex-col gap-4">
                <MessengerInstructions messenger="slack" />
                {slackInstallUrl && (
                  <SlackInstallRequest
                    href={slackInstallUrl}
                    workspaceLabel="Slack workspace"
                  />
                )}
              </div>
            ),
          },
        ]
      : []),
    ...(available.telegram
      ? [
          {
            icon: <TelegramIcon />,
            kind: "expand" as const,
            title: "Telegram",
            description: "Message the agent from a Telegram chat.",
            content: <MessengerInstructions messenger="telegram" />,
          },
        ]
      : []),
  ];

  return <ActionList actions={actions} />;
}
