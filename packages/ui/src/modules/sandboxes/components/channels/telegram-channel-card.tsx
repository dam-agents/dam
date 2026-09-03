import { Add } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";

import { useUnbindTelegramChat } from "../../../telegram/api/mutations.js";
import { useTelegramChats } from "../../../telegram/api/queries.js";
import { openBindModal } from "./bind-modal-state.js";
import { ChannelCard } from "./channel-card.js";

export function TelegramChannelCard({ agentId }: { agentId: string }) {
  return (
    <ChannelCard iconSlug="telegram" title="Telegram">
      <div className="flex flex-col items-start gap-3 px-4 py-4">
        <ConnectedChats agentId={agentId} />
        <Button
          variant="outline"
          size="sm"
          onClick={() => openBindModal(["telegram"])}
          data-testid="telegram-connect"
        >
          <Add size={16} />
          Connect chat
        </Button>
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
