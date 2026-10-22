import type { OutageAlertAgent } from "api-server-api";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { AgentAvatar } from "../../agents/components/avatar/agent-avatar.js";
import { affectedByLine } from "../lib/outage-alert-copy.js";

interface Props {
  agent: OutageAlertAgent;
  name: string;
  avatar: string | null | undefined;
  switchable: boolean;
}

export function OutageAlertAgentRow({
  agent,
  name,
  avatar,
  switchable,
}: Props) {
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);

  return (
    <li className="flex items-center gap-2">
      <AgentAvatar name={name} avatar={avatar} size={20} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-foreground">{name}</p>
        <p className="text-sm text-muted-foreground">
          {affectedByLine(agent.affectedBy)}
        </p>
      </div>
      {switchable && (
        <Button
          variant="link"
          size="inline"
          onClick={() => navigateToSandboxHome(agent.agentId, "providers")}
          className="shrink-0 text-sm"
        >
          Switch provider
        </Button>
      )}
    </li>
  );
}
