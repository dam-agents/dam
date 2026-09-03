import { Help } from "@carbon/icons-react";

import { cardSelectionVariants } from "@/components/ui/card";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Inset } from "@/components/ui/inset";
import { SectionLabel } from "@/components/ui/section-label";
import { ConnectionIcon } from "@/modules/connections/components/connection-icon";

export type Destination = "platform" | "slack" | "telegram";

interface Props {
  selected: Destination[];
  onToggle: (d: Destination) => void;
  slackAvailable?: boolean;
  telegramAvailable?: boolean;
}

export function DestinationSection({
  selected,
  onToggle,
  slackAvailable = true,
  telegramAvailable = true,
}: Props) {
  if (!slackAvailable && !telegramAvailable) return null;

  return (
    <section className="mb-8">
      <SectionLabel spaced>Channels</SectionLabel>
      <Inset className="flex flex-col gap-3">
        {slackAvailable && (
          <ChannelCard
            icon={<ConnectionIcon iconSlug="slack" alt="" size={16} />}
            label="Slack Channel"
            description="You can interact with the agent in your DMs, or bind it to a channel for your team to use."
            selected={selected.includes("slack")}
            onClick={() => onToggle("slack")}
            hint={<SlackChannelExplainer />}
          />
        )}

        {telegramAvailable && (
          <ChannelCard
            icon={<ConnectionIcon iconSlug="telegram" alt="" size={16} />}
            label="Telegram Chat"
            description="Your team can interact with the agent in a Telegram group or DM."
            selected={selected.includes("telegram")}
            onClick={() => onToggle("telegram")}
          />
        )}
      </Inset>
    </section>
  );
}

function ChannelCard({
  icon,
  label,
  description,
  selected,
  onClick,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  selected: boolean;
  onClick: () => void;
  hint?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cardSelectionVariants({
        selected,
        className: "flex items-center gap-3 px-4 py-3 text-left",
      })}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          {label}
          {hint && (
            <HoverCard openDelay={200} closeDelay={300}>
              <HoverCardTrigger asChild>
                <span
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex shrink-0 cursor-help text-muted-foreground transition-colors hover:text-foreground/60"
                >
                  <Help size={16} />
                </span>
              </HoverCardTrigger>
              <HoverCardContent
                side="bottom"
                align="start"
                className="max-w-xs p-4"
              >
                {hint}
              </HoverCardContent>
            </HoverCard>
          )}
        </span>
        <span className="block text-sm text-muted-foreground">
          {description}
        </span>
      </span>
      <span className="ml-auto shrink-0">
        <span
          className={`flex size-4 items-center justify-center rounded-full border ${selected ? "border-foreground" : "border-muted-foreground/50"}`}
        >
          {selected && <span className="size-2 rounded-full bg-foreground" />}
        </span>
      </span>
    </button>
  );
}

function SlackChannelExplainer() {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
      <p>
        With Channels, you can DM or bind your agent to a team channel. The
        agent answers as itself always.
      </p>
      <p>
        If you want to give this agent access to your Slack Account, that's a
        Connection.
      </p>
      <p>
        <span className="font-medium text-accent">Go to Connections &rarr;</span>
      </p>
    </div>
  );
}
