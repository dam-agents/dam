import type { ReactNode, Ref } from "react";

import { SlackChannelExplainer } from "@/components/channel-connection-explainer";
import { Checkbox } from "@/components/ui/checkbox";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

import { useAgents } from "../../../agents/api/queries.js";
import { ConnectionIcon } from "../../../connections/components/connection-icon.js";

interface SetupChannelSelection {
  slack: boolean;
  telegram: boolean;
}

interface MessengerRow {
  key: keyof SetupChannelSelection;
  iconSlug: string;
  label: string;
  description: string;
}

const ROWS: MessengerRow[] = [
  {
    key: "slack",
    iconSlug: "slack",
    label: "Slack Channel",
    description:
      "You can interact with the agent in your DMs, or bind it to a channel for your team to use.",
  },
  {
    key: "telegram",
    iconSlug: "telegram",
    label: "Telegram Chat",
    description:
      "Your team can interact with the agent in a Telegram group or DM.",
  },
];

export function SetupChannelsSection({
  value,
  onChange,
  onGoToConnections,
  slackCheckboxRef,
}: {
  value: SetupChannelSelection;
  onChange: (next: SetupChannelSelection) => void;
  onGoToConnections?: () => void;
  slackCheckboxRef?: Ref<HTMLButtonElement>;
}) {
  const available = useAgents().data?.availableChannels;
  const offered = ROWS.filter((row) => available?.[row.key]);

  return (
    <section className="mb-8">
      <SectionLabel spaced>Channels</SectionLabel>
      {available && offered.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No messenger is set up on this platform, so there is nothing to
          connect yet. Ask your operator to configure Slack or Telegram.
        </p>
      )}
      {offered.length > 0 && (
        <div className="flex flex-col gap-2">
          {offered.map((row) => (
            <MessengerCheckboxRow
              key={row.key}
              row={row}
              checked={value[row.key]}
              onCheckedChange={(checked) =>
                onChange({ ...value, [row.key]: checked })
              }
              checkboxRef={row.key === "slack" ? slackCheckboxRef : undefined}
              explainer={
                row.key === "slack" ? (
                  <SlackChannelExplainer
                    onGoToConnections={onGoToConnections}
                  />
                ) : null
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}

function MessengerCheckboxRow({
  row,
  checked,
  onCheckedChange,
  checkboxRef,
  explainer,
}: {
  row: MessengerRow;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  checkboxRef?: Ref<HTMLButtonElement>;
  explainer?: ReactNode;
}) {
  const inputId = `setup-channel-${row.key}`;
  return (
    <label
      htmlFor={inputId}
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-md border px-4 py-3 transition-colors",
        checked ? "border-primary bg-muted/50" : "border-border bg-background",
      )}
    >
      <ConnectionIcon
        iconSlug={row.iconSlug}
        alt=""
        size={20}
        className="mt-0.5 shrink-0"
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          {row.label}
          {explainer}
        </span>
        <span className="mt-0.5 block text-sm text-muted-foreground">
          {row.description}
        </span>
      </span>
      <Checkbox
        ref={checkboxRef}
        id={inputId}
        checked={checked}
        onCheckedChange={(state) => onCheckedChange(state === true)}
        aria-label={row.label}
        className="mt-0.5"
      />
    </label>
  );
}
