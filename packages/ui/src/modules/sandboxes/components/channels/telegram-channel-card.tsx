import { Button } from "@/components/ui/button";
import { externalLinkProps } from "@/lib/external-link";

import { getBrand } from "../../../../brand.js";
import { useUnbindTelegramChat } from "../../../telegram/api/mutations.js";
import {
  useTelegramBot,
  useTelegramChats,
} from "../../../telegram/api/queries.js";
import { ChannelCard } from "./channel-card.js";

/** Telegram is a platform-wide bot; chats bind via the bind command in the
 *  chat — the same `/dam bind` / `/dam unbind` surface Slack uses. */
export function TelegramChannelCard({ agentId }: { agentId: string }) {
  const brandShort = getBrand().short;
  const bot = useTelegramBot();
  const handle = bot.data?.username;

  return (
    <ChannelCard iconSlug="telegram" title="Telegram">
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
          to a chat (or message it directly) and send{" "}
          <code>/{brandShort} bind</code> to pick the agent in the browser. Send{" "}
          <code>/{brandShort} unbind</code> in the chat to disconnect.
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
        <div
          key={chat.conversationId}
          className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5"
        >
          <span className="flex-1 truncate text-sm text-foreground">
            {chat.title}
          </span>
          <Button
            variant="ghost"
            tone="danger"
            size="sm"
            disabled={unbind.isPending}
            onClick={() =>
              unbind.mutate({ agentId, conversationId: chat.conversationId })
            }
            className="shrink-0"
          >
            Disconnect
          </Button>
        </div>
      ))}
    </div>
  );
}
