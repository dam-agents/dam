import { ChannelType } from "api-server-api";

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
}: {
  agent: AgentView;
  className?: string;
}) {
  const slackNames = agent.channels
    .filter((c) => c.type === ChannelType.Slack)
    .map(slackChannelLabel);
  const telegramReady = useAgents().data?.availableChannels?.telegram;
  const telegramNames = (
    useTelegramChats(telegramReady ? agent.id : undefined).data?.chats ?? []
  ).map((chat) => chat.title);

  if (slackNames.length === 0 && telegramNames.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <MessengerChip iconSlug="slack" names={slackNames} />
      <MessengerChip iconSlug="telegram" names={telegramNames} />
    </div>
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
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
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
    </span>
  );
}
