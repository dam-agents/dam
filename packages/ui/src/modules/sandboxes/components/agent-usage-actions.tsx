import {
  Chat,
  ChevronDown,
  Code,
  Launch,
  LogoSlack,
  Terminal,
  Tools,
} from "@carbon/icons-react";
import { SessionMode } from "api-server-api";
import type { ReactNode } from "react";

import { getBrand } from "@/brand";
import { PromptIcon, TelegramIcon } from "@/components/brand-icons";
import { CopyableCommand } from "@/components/copyable-command";
import { Button } from "@/components/ui/button";
import { externalLinkProps } from "@/lib/external-link";

import { CLI_REFERENCE_URL } from "../../../constants.js";
import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useAgents } from "../../agents/api/queries.js";
import { holds } from "../../agents/lib/agent-permissions.js";
import { useSlackInstallRequestUrl } from "../../links/api/queries.js";
import { TerminalHarnessMenu } from "../../sessions/components/terminal-harness-menu.js";
import { SlackInstallRequest } from "../../slack/components/slack-install-request.js";
import { cliAgentRef } from "../lib/cli-agent-ref.js";
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
  showConfigure = false,
  onNewTerminal,
}: {
  agent: AgentView;
  showChat?: boolean;
  showConfigure?: boolean;
  onNewTerminal?: () => void;
}) {
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const selectAgent = useStore((s) => s.selectAgent);
  const openAgentSession = useStore((s) => s.openAgentSession);
  const agentsData = useAgents().data;
  const available = agentsData?.availableChannels ?? {};
  const ref = cliAgentRef(agent, agentsData?.list ?? [agent]);
  const slackInstallUrl = useSlackInstallRequestUrl();
  const brand = getBrand();
  const terminal = holds(agent.access, "terminal");
  const channels = holds(agent.access, "channels");

  const chatActions: Action[] =
    showChat && holds(agent.access, "sessions")
      ? [
          {
            icon: <Chat />,
            kind: "link",
            title: "Chat",
            description: "Chat with the agent in this browser.",
            onClick: () => selectAgent(agent.id),
          },
        ]
      : [];
  const terminalActions: Action[] = [
    {
      icon: <Terminal />,
      kind: "control",
      title: "Web terminal",
      description: "Run a harness in this browser.",
      control: (
        <TerminalHarnessMenu
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
        >
          <Button variant="outline" className="shrink-0">
            Open <ChevronDown size={16} />
          </Button>
        </TerminalHarnessMenu>
      ),
    },
    {
      icon: <PromptIcon />,
      kind: "expand",
      title: "CLI and SSH",
      description: "Use the agent from your own terminal or over SSH.",
      content: (
        <div className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>
            Follow the{" "}
            <DocLink href={CLI_REFERENCE_URL}>CLI quickstart</DocLink> to
            install the {brand.name} CLI and log in.
          </p>
          <p className="mt-1">Open the agent TUI in your terminal:</p>
          <CopyableCommand command={`${brand.short} chat ${ref}`} />
          <p className="mt-1">SSH to the agent:</p>
          <CopyableCommand command={`${brand.short} ssh connect ${ref}`} />
        </div>
      ),
    },
    {
      icon: <Code />,
      kind: "expand",
      title: "VS Code and Zed",
      description: "Work in the agent's workspace from your own editor.",
      content: (
        <div className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>
            With the {brand.name} CLI installed (see the{" "}
            <DocLink href={CLI_REFERENCE_URL}>CLI quickstart</DocLink>), open a
            remote <DocLink href={VS_CODE_REMOTE_URL}>VS Code</DocLink> (or{" "}
            <DocLink href={ZED_REMOTE_URL}>Zed</DocLink> with{" "}
            <code className="font-mono">-x zed</code>) session and work directly
            in the agent's workspace:
          </p>
          <CopyableCommand
            command={`${brand.short} ssh connect -x code ${ref}`}
          />
        </div>
      ),
    },
  ];
  const messengerActions: Action[] = [
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
  const actions: Action[] = [
    ...chatActions,
    ...(terminal ? terminalActions : []),
    ...(channels ? messengerActions : []),
    ...(showConfigure
      ? [
          {
            icon: <Tools />,
            kind: "link" as const,
            title: "Configure agent",
            description: "Set LLM providers, skills, connections, and more.",
            onClick: () => navigateToSandboxHome(agent.id),
          },
        ]
      : []),
  ];

  return <ActionList actions={actions} />;
}
