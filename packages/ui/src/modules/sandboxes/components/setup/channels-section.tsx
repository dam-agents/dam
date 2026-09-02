import { useState } from "react";

import { cardSelectionVariants } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";

type AgentKind = "coding" | "research" | "knowledge-base" | "assistant";

const DESCRIPTORS: Record<AgentKind, string> = {
  coding:
    "A coding agent can work in a Slack channel, where your team can give it tasks.",
  research:
    "A research agent can work in a Slack channel, surfacing insights from tools like Nous and OpenEvolve for your team.",
  "knowledge-base":
    "A knowledge base agent can answer questions in a Slack channel, giving your team instant access to internal docs.",
  assistant:
    "An assistant agent can work in a Slack channel, helping your team with daily tasks and coordination.",
};

const KIND_LABELS: { value: AgentKind; label: string }[] = [
  { value: "coding", label: "Coding" },
  { value: "research", label: "Research" },
  { value: "knowledge-base", label: "Knowledge base" },
  { value: "assistant", label: "Assistant" },
];

type ChannelType = "slack" | "telegram";

interface Props {
  selected: ChannelType[];
  onToggle: (channel: ChannelType) => void;
  defaultKind?: AgentKind;
}

export function ChannelsSection({
  selected,
  onToggle,
  defaultKind = "coding",
}: Props) {
  const [previewKind, setPreviewKind] = useState<AgentKind>(defaultKind);

  return (
    <section className="mb-8">
      <SectionLabel spaced>Channels</SectionLabel>

      <div className="mb-3 flex items-center gap-1.5">
        {KIND_LABELS.map((k) => (
          <button
            key={k.value}
            type="button"
            onClick={() => setPreviewKind(k.value)}
            className={`rounded-md px-2.5 py-1 text-sm font-medium transition-colors ${
              previewKind === k.value
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            {k.label}
          </button>
        ))}
      </div>

      <p className="-mt-1 mb-4 text-sm text-muted-foreground">
        {DESCRIPTORS[previewKind]}
      </p>

      <div className="flex flex-col gap-3">
        <ChannelOption
          type="slack"
          label="In a Slack channel"
          icon="/icons/slack.svg"
          selected={selected.includes("slack")}
          onToggle={() => onToggle("slack")}
        />
        <ChannelOption
          type="telegram"
          label="In a Telegram channel"
          icon="/icons/telegram.svg"
          selected={selected.includes("telegram")}
          onToggle={() => onToggle("telegram")}
        />
      </div>

      {selected.length > 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          You&apos;ll configure the channel details after the agent is created.
        </p>
      )}
    </section>
  );
}

function ChannelOption({
  label,
  icon,
  selected,
  onToggle,
}: {
  type: string;
  label: string;
  icon: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cardSelectionVariants({
        selected,
        className: "flex items-center gap-3 px-4 py-3 text-left",
      })}
    >
      <img src={icon} alt="" width={16} height={16} className="shrink-0" />
      <span className="text-sm font-medium text-foreground">{label}</span>
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
