import { Button } from "@/components/ui/button";
import { CopyableCommand } from "@/components/copyable-command";
import { externalLinkProps } from "@/lib/external-link";

import { getBrand } from "../../../../brand.js";
import { useTelegramBot } from "../../../telegram/api/queries.js";

type ChannelKind = "slack" | "telegram";

interface Props {
  kind: ChannelKind;
  compact?: boolean;
  onUseChannelId?: () => void;
}

export function BindWalkthrough({ kind, compact, onUseChannelId }: Props) {
  if (kind === "slack") return <SlackSteps compact={compact} onUseChannelId={onUseChannelId} />;
  return <TelegramSteps compact={compact} />;
}

function SlackSteps({
  compact,
  onUseChannelId,
}: {
  compact?: boolean;
  onUseChannelId?: () => void;
}) {
  const brand = getBrand();

  return (
    <div className={compact ? "" : ""}>
      <ol className="flex flex-col gap-5">
        <Step number={1} title="Invite the bot to your channel">
          <p className="mt-1 text-sm text-muted-foreground">
            In the Slack channel your team already uses, run:
          </p>
          <div className="mt-2">
            <CopyableCommand command={`/invite @${brand.name}`} />
          </div>
        </Step>

        <Step number={2} title="Run the bind command there">
          <p className="mt-1 text-sm text-muted-foreground">
            Then, in the same channel, run:
          </p>
          <div className="mt-2">
            <CopyableCommand command={`/${brand.short} bind`} />
          </div>
        </Step>

        <Step number={3} title="Pick this agent on the page Slack opens">
          <p className="mt-1 text-sm text-muted-foreground">
            Follow the link Slack posts, pick this agent, and confirm. That
            confirmation grants the access.
          </p>
        </Step>
      </ol>

      <div className="mt-5 flex items-center gap-2">
        <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
        <span className="text-sm text-muted-foreground">
          Waiting for Slack. This updates as soon as the channel is added.
        </span>
      </div>

      {onUseChannelId && (
        <p className="mt-3 text-sm text-muted-foreground">
          Already have the channel ID from Slack?{" "}
          <Button
            variant="link"
            size="inline"
            onClick={onUseChannelId}
            data-testid="bind-use-id"
          >
            Add it with a channel ID
          </Button>
        </p>
      )}
    </div>
  );
}

function TelegramSteps({ compact }: { compact?: boolean }) {
  const brand = getBrand();
  const bot = useTelegramBot();
  const handle = bot.data?.username;

  return (
    <div className={compact ? "" : ""}>
      <ol className="flex flex-col gap-5">
        <Step number={1} title="Add the bot to your chat">
          <p className="mt-1 text-sm text-muted-foreground">
            Add{" "}
            {handle ? (
              <>@{handle}</>
            ) : (
              "this installation's Telegram bot"
            )}{" "}
            to the Telegram group your team already uses. For a one-to-one chat,
            open it directly.
          </p>
          {handle && (
            <div className="mt-2">
              <Button variant="outline" size="sm" asChild>
                <a
                  href={`https://t.me/${handle}`}
                  {...externalLinkProps}
                >
                  Open @{handle} in Telegram &#x2197;
                </a>
              </Button>
            </div>
          )}
        </Step>

        <Step number={2} title="Send the bind command there">
          <p className="mt-1 text-sm text-muted-foreground">
            In that chat, send:
          </p>
          <div className="mt-2">
            <CopyableCommand command={`/${brand.short} bind`} />
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            In a group, only admins can run this.
          </p>
        </Step>

        <Step number={3} title="Pick this agent on the page Telegram opens">
          <p className="mt-1 text-sm text-muted-foreground">
            Follow the link the bot posts, pick this agent, and confirm. That
            confirmation grants the access. The link works for about 10 minutes.
          </p>
        </Step>
      </ol>

      <div className="mt-5 flex items-center gap-2">
        <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
        <span className="text-sm text-muted-foreground">
          Waiting for Telegram. This updates as soon as the chat is connected.
        </span>
      </div>
    </div>
  );
}

function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-background text-xs font-medium">
        {number}
      </span>
      <div className="min-w-0 flex-1">
        <span className="text-[15px] font-medium text-foreground">{title}</span>
        {children}
      </div>
    </li>
  );
}
