import { cardSelectionVariants } from "@/components/ui/card";
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
            label="In a Slack channel"
            description="Your team can interact with the agent in a Slack channel or their DMs."
            selected={selected.includes("slack")}
            onClick={() => onToggle("slack")}
          />
        )}

        {telegramAvailable && (
          <ChannelCard
            icon={<ConnectionIcon iconSlug="telegram" alt="" size={16} />}
            label="In a Telegram chat"
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
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  selected: boolean;
  onClick: () => void;
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
        <span className="block text-sm font-medium text-foreground">
          {label}
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
