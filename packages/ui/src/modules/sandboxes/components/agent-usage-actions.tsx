import { Chat, ChevronDown, Terminal } from "@carbon/icons-react";
import { SessionMode } from "api-server-api";
import type { ReactNode } from "react";

import { getBrand } from "@/brand";
import { CopyableCommand } from "@/components/copyable-command";
import { Button } from "@/components/ui/button";
import { externalLinkProps } from "@/lib/external-link";

import { CLI_REFERENCE_URL } from "../../../constants.js";
import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useAgents } from "../../agents/api/queries.js";
import { useSlackInstallRequestUrl } from "../../links/api/queries.js";
import { TerminalHarnessMenu } from "../../sessions/components/terminal-harness-menu.js";
import { SlackInstallRequest } from "../../slack/components/slack-install-request.js";
import { type Action, ActionList } from "./action-list.js";
import { MessengerInstructions } from "./channels/channel-bind-modal.js";

const VS_CODE_REMOTE_URL = "https://code.visualstudio.com/docs/remote/ssh";
const ZED_REMOTE_URL = "https://zed.dev/docs/remote-development";

function DocLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      {...externalLinkProps}
      className="font-medium text-foreground hover:underline"
    >
      {children}
    </a>
  );
}

export function AgentUsageActions({ agent }: { agent: AgentView }) {
  const selectAgent = useStore((s) => s.selectAgent);
  const openAgentSession = useStore((s) => s.openAgentSession);
  const available = useAgents().data?.availableChannels ?? {};
  const slackInstallUrl = useSlackInstallRequestUrl();
  const brand = getBrand();

  const actions: Action[] = [
    {
      title: "Chat",
      description: "Chat with the agent in this browser.",
      button: {
        icon: <Chat />,
        label: "Open chat",
        onClick: () => selectAgent(agent.id),
      },
    },
    {
      title: "Web terminal",
      description: "Open the harnesses' terminal UI in this browser.",
      control: (
        <TerminalHarnessMenu
          agentId={agent.id}
          onOpen={() =>
            openAgentSession(
              agent.id,
              crypto.randomUUID(),
              SessionMode.Terminal,
              true,
            )
          }
        >
          <Button
            variant="outline"
            className="shrink-0 self-start sm:self-auto"
          >
            <Terminal />
            Open terminal
            <ChevronDown />
          </Button>
        </TerminalHarnessMenu>
      ),
    },
    {
      title: "CLI and SSH",
      description: (
        <>
          Follow the <DocLink href={CLI_REFERENCE_URL}>CLI quickstart</DocLink>{" "}
          to install the {brand.name} CLI and log in.
        </>
      ),
      content: (
        <div className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>Open the agent TUI in your terminal:</p>
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
            title: "Telegram",
            description: "Message the agent from a Telegram chat.",
            content: <MessengerInstructions messenger="telegram" />,
          },
        ]
      : []),
  ];

  return <ActionList actions={actions} />;
}
