import { BindSuccessPage } from "../../agents/components/bind/bind-success-page.js";
import { CommandChip } from "../../agents/components/bind/command-chip.js";
import { useTelegramBot } from "../api/queries.js";

interface Props {
  agentName: string;
  chatTitle: string | null;
}

export function TelegramBindSuccess({ agentName, chatTitle }: Props) {
  const bot = useTelegramBot();
  const chat = chatTitle ?? "this chat";

  return (
    <BindSuccessPage
      messenger="telegram"
      title={`${agentName} has been added to ${chat}`}
    >
      <p>
        Send a message in the chat to use it. In a group the agent reads along
        and answers when the conversation is for it.
      </p>
      <p>
        Disconnect anytime with <CommandChip>/unbind</CommandChip>.
      </p>
      {bot.data?.username && (
        <a
          className="underline text-foreground"
          href={`https://t.me/${bot.data.username}`}
        >
          Open @{bot.data.username} in Telegram
        </a>
      )}
    </BindSuccessPage>
  );
}
