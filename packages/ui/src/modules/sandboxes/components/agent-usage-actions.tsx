import { Chat, Code, Terminal } from "@carbon/icons-react";

import { CopyableCommand } from "@/components/copyable-command";
import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { type Action, ActionList } from "./action-list.js";

export function AgentUsageActions({ agent }: { agent: AgentView }) {
  const selectAgent = useStore((s) => s.selectAgent);

  const actions: Action[] = [
    {
      icon: <Chat />,
      kind: "link",
      title: "Chat",
      description: "Chat with the agent in this browser.",
      onClick: () => selectAgent(agent.id),
    },
    {
      icon: <Terminal />,
      kind: "control",
      title: "Web terminal",
      description: "Run a harness in this browser.",
      control: (
        <Button variant="outline" className="shrink-0">
          Open
        </Button>
      ),
    },
    {
      icon: <Code />,
      kind: "expand",
      title: "CLI and SSH",
      description: "Use the agent from your own terminal or over SSH.",
      content: (
        <div className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>Open the agent TUI in your terminal:</p>
          <CopyableCommand command={`platform chat ${agent.name}`} />
          <p className="mt-1">SSH to the agent:</p>
          <CopyableCommand command={`platform ssh connect ${agent.name}`} />
        </div>
      ),
    },
  ];

  return <ActionList actions={actions} />;
}
