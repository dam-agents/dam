import { cardSelectionVariants } from "@/components/ui/card";
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

  const isPlatformOnly =
    selected.length === 0 ||
    (selected.length === 1 && selected.includes("platform"));

  function handleToggle(d: Destination) {
    if (d === "platform") {
      onToggle("platform");
    } else {
      onToggle(d);
    }
  }

  return (
    <section className="mb-8">
      <SectionLabel spaced>Where will this agent work?</SectionLabel>
      <div className="flex flex-col gap-3">
        <DestinationCard
          icon={
            <span className="flex size-4 items-center justify-center rounded bg-foreground text-background">
              <svg width={10} height={10} viewBox="0 0 10 10" fill="none">
                <rect x={1} y={1} width={8} height={8} rx={1.5} fill="currentColor" />
              </svg>
            </span>
          }
          label="In the platform"
          description="Only you can reach it. Work happens here."
          selected={isPlatformOnly}
          onClick={() => handleToggle("platform")}
        />

        {slackAvailable && (
          <DestinationCard
            icon={
              <ConnectionIcon iconSlug="slack" alt="" size={16} />
            }
            label="In a Slack channel"
            description="Your team can interact with the agent in a Slack channel."
            selected={selected.includes("slack")}
            onClick={() => handleToggle("slack")}
          />
        )}

        {telegramAvailable && (
          <DestinationCard
            icon={
              <ConnectionIcon iconSlug="telegram" alt="" size={16} />
            }
            label="In a Telegram chat"
            description="Your team can interact with the agent in a Telegram group or DM."
            selected={selected.includes("telegram")}
            onClick={() => handleToggle("telegram")}
          />
        )}
      </div>
    </section>
  );
}

function DestinationCard({
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
        {selected ? (
          <CheckIcon />
        ) : (
          <span className="block h-5 w-5 rounded-full border-2 border-border" />
        )}
      </span>
    </button>
  );
}

function CheckIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 20 20"
      fill="none"
      className="text-foreground"
    >
      <circle cx={10} cy={10} r={10} fill="currentColor" />
      <path
        d="M6 10.5l2.5 2.5L14 7.5"
        stroke="white"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
