import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

import { StatusBadge } from "../../../components/status-indicator.js";
import type { AgentView } from "../../../types.js";
import { agentKindBadge } from "../utils/agent-kind.js";
import type { AgentDisplay } from "../utils/agent-resolver.js";

interface Props {
  agent: AgentView;
  display: AgentDisplay;
  subtitle: string;
}

export function AgentCard({ agent, display, subtitle }: Props) {
  const kindBadge = agentKindBadge(agent);
  const slackChannels = agent.channels.filter((c) => c.type === "slack");

  return (
    <Card className="flex flex-col gap-3 border border-border p-5 transition-colors hover:bg-muted/40">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="min-w-0 truncate text-base font-medium text-foreground">
              {agent.name}
            </h2>
            {kindBadge && (
              <Badge variant={kindBadge.variant} className="shrink-0">
                {kindBadge.label}
              </Badge>
            )}
          </div>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {subtitle}
          </p>
        </div>
        <div className="shrink-0">
          <StatusBadge state={display.state} />
        </div>
      </div>

      {slackChannels.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          {slackChannels.map((ch) => (
            <span
              key={ch.type === "slack" ? ch.slackChannelId : ""}
              className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1"
            >
              <img
                src="/icons/slack.svg"
                alt=""
                width={16}
                height={16}
                className="shrink-0"
              />
              <span className="text-sm text-muted-foreground">
                {ch.type === "slack" ? `#${ch.slackChannelId}` : ""}
              </span>
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}
