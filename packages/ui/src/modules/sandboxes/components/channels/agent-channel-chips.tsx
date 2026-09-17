import { ChannelType } from "api-server-api";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import type { AgentView } from "../../../../types.js";
import { useAgents } from "../../../agents/api/queries.js";
import { ConnectionIcon } from "../../../connections/components/connection-icon.js";
import { useTelegramChats } from "../../../telegram/api/queries.js";
import { slackChannelLabel } from "../../hooks/use-slack-channel-form.js";

const SHOWN = 2;

export function AgentChannelChips({
  agent,
  className,
  children,
}: {
  agent: AgentView;
  className?: string;
  children?: ReactNode;
}) {
  const slackNames = agent.channels
    .filter((c) => c.type === ChannelType.Slack)
    .map(slackChannelLabel);
  const telegramReady = useAgents().data?.availableChannels?.telegram;
  const telegramNames = (
    useTelegramChats(telegramReady ? agent.id : undefined).data?.chats ?? []
  ).map((chat) => chat.title);

  if (slackNames.length === 0 && telegramNames.length === 0 && !children)
    return null;

  return (
    <span className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <MessengerChip iconSlug="slack" names={slackNames} />
      <MessengerChip iconSlug="telegram" names={telegramNames} />
      {children}
    </span>
  );
}

function MessengerChip({
  iconSlug,
  names,
}: {
  iconSlug: string;
  names: string[];
}) {
  if (names.length === 0) return null;
  const shown = names.slice(0, SHOWN);
  const hidden = names.length - shown.length;
  return (
    <Badge
      variant="muted"
      className="max-w-full gap-1.5"
      title={names.join(", ")}
    >
      <ConnectionIcon
        iconSlug={iconSlug}
        alt=""
        size={12}
        className="shrink-0"
      />
      <span className="truncate">
        {shown.join(", ")}
        {hidden > 0 && ` +${hidden}`}
      </span>
    </Badge>
  );
}
