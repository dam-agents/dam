import { CopyableCommand } from "@/components/copyable-command";
import { Button } from "@/components/ui/button";
import { externalLinkProps } from "@/lib/external-link";

import { getBrand } from "../../../../brand.js";
import { useTelegramBot } from "../../../telegram/api/queries.js";

type ChannelKind = "slack" | "telegram";

interface Props {
  kind: ChannelKind;
  compact?: boolean;
}

export function BindWalkthrough({ kind, compact }: Props) {
  if (kind === "slack") return <SlackSteps compact={compact} />;
  return <TelegramSteps compact={compact} />;
}

function SlackSteps({ compact }: { compact?: boolean }) {
  const brand = getBrand();

  return (
    <div className={compact ? "" : ""}>
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-sm font-medium text-foreground">
            1. Invite the bot to your channel
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            In the Slack channel your team already uses, run:
          </p>
          <div className="mt-2">
            <CopyableCommand
              showPrompt={false}
              command={`/invite @${brand.name}`}
            />
          </div>
        </div>

        <div>
          <p className="text-sm font-medium text-foreground">
            2. Run the bind command there
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Then, in the same channel, run:
          </p>
          <div className="mt-2">
            <CopyableCommand
              showPrompt={false}
              command={`/${brand.short} bind`}
            />
          </div>
        </div>

        <div>
          <p className="text-sm font-medium text-foreground">
            3. Pick this agent on the page Slack opens
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Follow the link Slack posts, pick this agent, and confirm. That
            confirmation grants the access.
          </p>
        </div>
      </div>
    </div>
  );
}

function TelegramSteps({ compact }: { compact?: boolean }) {
  const brand = getBrand();
  const bot = useTelegramBot();
  const handle = bot.data?.username;

  return (
    <div className={compact ? "" : ""}>
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-sm font-medium text-foreground">
            1. Add the bot to your chat
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add {handle ? <>@{handle}</> : "this installation's Telegram bot"}{" "}
            to the Telegram group your team already uses. For a one-to-one chat,
            open it directly.
          </p>
          {handle && (
            <div className="mt-2">
              <Button variant="outline" size="sm" asChild>
                <a href={`https://t.me/${handle}`} {...externalLinkProps}>
                  Open @{handle} in Telegram &#x2197;
                </a>
              </Button>
            </div>
          )}
        </div>

        <div>
          <p className="text-sm font-medium text-foreground">
            2. Send the bind command there
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            In that chat, send:
          </p>
          <div className="mt-2">
            <CopyableCommand
              showPrompt={false}
              command={`/${brand.short} bind`}
            />
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            In a group, only admins can run this.
          </p>
        </div>

        <div>
          <p className="text-sm font-medium text-foreground">
            3. Pick this agent on the page Telegram opens
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Follow the link the bot posts, pick this agent, and confirm. That
            confirmation grants the access. The link works for about 10 minutes.
          </p>
        </div>
      </div>
    </div>
  );
}
