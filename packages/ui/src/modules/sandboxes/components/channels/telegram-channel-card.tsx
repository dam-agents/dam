import { useState } from "react";

import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { ListSection } from "@/components/ui/list-section";
import { externalLinkProps } from "@/lib/external-link";

import { ConnectionIcon } from "../../../connections/components/connection-icon.js";
import { useUnbindTelegramChat } from "../../../telegram/api/mutations.js";
import {
  useTelegramBot,
  useTelegramChats,
} from "../../../telegram/api/queries.js";
import { ChannelRow } from "./channel-row.js";

export function TelegramChannelCard({ agentId }: { agentId: string }) {
  const chats = useTelegramChats(agentId);
  const unbind = useUnbindTelegramChat();
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const list = chats.data?.chats ?? [];

  return (
    <>
      <ListSection
        label={
          <span className="flex items-center gap-2">
            <ConnectionIcon iconSlug="telegram" alt="" size={14} />
            Telegram chats
          </span>
        }
        onNew={() => setInstructionsOpen(true)}
        newTestId="telegram-connect"
        isEmpty={chats.isSuccess && list.length === 0}
        empty="No chats connected yet."
      >
        {chats.isPending && (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            Loading connected chats…
          </p>
        )}
        {chats.isError && (
          <p className="px-4 py-3 text-sm text-warning">
            Couldn't load the connected chats — reload to see them.
          </p>
        )}
        {list.map((chat) => (
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
                  unbind.mutate({
                    agentId,
                    conversationId: chat.conversationId,
                  })
                }
              >
                Disconnect
              </DropdownMenuItem>
            }
          />
        ))}
      </ListSection>
      {instructionsOpen && (
        <TelegramBindModal onClose={() => setInstructionsOpen(false)} />
      )}
    </>
  );
}

function TelegramBindModal({ onClose }: { onClose: () => void }) {
  const handle = useTelegramBot().data?.username;
  return (
    <Modal onClose={onClose}>
      <DialogHeader onClose={onClose} title="Connect a Telegram chat" />
      <DialogBody>
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
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose}>Done</Button>
      </DialogFooter>
    </Modal>
  );
}
