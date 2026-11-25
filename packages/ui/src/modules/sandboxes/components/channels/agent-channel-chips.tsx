import { ChannelType } from "api-server-api";
import type { ComponentType, ReactNode, SVGProps } from "react";

import { SlackColorIcon, TelegramColorIcon } from "@/components/brand-icons";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import type { AgentView } from "../../../../types.js";
import { useAgents } from "../../../agents/api/queries.js";
import { useTelegramChats } from "../../../telegram/api/queries.js";
import { slackChannelLabel } from "../../lib/slack-channels.js";

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
      <MessengerChip Logo={SlackColorIcon} names={slackNames} />
      <MessengerChip Logo={TelegramColorIcon} names={telegramNames} />
      {children}
    </span>
  );
}

function MessengerChip({
  Logo,
  names,
}: {
  Logo: ComponentType<SVGProps<SVGSVGElement>>;
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
      <Logo aria-hidden className="size-4 shrink-0" />
      <span className="truncate">
        {shown.join(", ")}
        {hidden > 0 && ` +${hidden}`}
      </span>
    </Badge>
  );
}
