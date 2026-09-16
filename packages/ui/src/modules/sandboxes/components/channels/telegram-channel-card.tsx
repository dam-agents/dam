import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { externalLinkProps } from "@/lib/external-link";

import { useUnbindTelegramChat } from "../../../telegram/api/mutations.js";
import {
  useTelegramBot,
  useTelegramChats,
} from "../../../telegram/api/queries.js";
import { ChannelCard } from "./channel-card.js";
import { ChannelRow } from "./channel-row.js";

export function TelegramChannelCard({ agentId }: { agentId: string }) {
  const bot = useTelegramBot();
  const handle = bot.data?.username;

  return (
    <ChannelCard iconSlug="telegram" title="Telegram Chat">
      <div className="flex flex-col gap-3 px-4 py-4">
        <ConnectedChats agentId={agentId} />
        <p className="text-sm text-muted-foreground">
          Add{" "}
          {handle ? (
            <a
              className="font-medium text-accent hover:underline"
              href={`https://t.me/${handle}`}
              {...externalLinkProps}
            >
              @{handle}
            </a>
          ) : (
            "this installation's Telegram bot"
          )}{" "}
          to a chat (or message it directly) and send <code>/bind</code> to pick
          the agent in the browser. Send <code>/unbind</code> in the chat to
          disconnect.
        </p>
      </div>
    </ChannelCard>
  );
}

function ConnectedChats({ agentId }: { agentId: string }) {
  const chats = useTelegramChats(agentId);
  const unbind = useUnbindTelegramChat();

  if (chats.isPending)
    return (
      <p className="text-sm text-muted-foreground">Loading connected chats…</p>
    );
  if (chats.isError || !chats.data) return null;
  if (chats.data.chats.length === 0)
    return (
      <p className="text-sm text-muted-foreground">No chats connected yet.</p>
    );

  return (
    <div className="flex flex-col gap-2">
      {chats.data.chats.map((chat) => (
        <ChannelRow
          key={chat.conversationId}
          title={chat.title}
          actionsLabel={`Telegram chat ${chat.title} actions`}
          menuTestId="telegram-chat-menu"
          actions={
            <DropdownMenuItem
              tone="danger"
              disabled={unbind.isPending}
              onSelect={() =>
                unbind.mutate({ agentId, conversationId: chat.conversationId })
              }
            >
              Disconnect
            </DropdownMenuItem>
          }
        />
      ))}
    </div>
  );
}
