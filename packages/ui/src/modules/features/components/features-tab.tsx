import { ErlenmeyerFlask } from "@carbon/pictograms-react";
import type { FeatureId } from "api-server-api";
import { type ReactNode, useId } from "react";

import { getBrand } from "@/brand";
import { CARD_SURFACE } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SectionLabel } from "@/components/ui/section-label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { ResetOnboardingCard } from "../../getting-started/components/reset-onboarding-card.js";
import {
  useFeatures,
  useInstallCapabilities,
  useSetFeature,
} from "../api/queries.js";
import { isFeatureOffered } from "../lib/visible-features.js";

interface FeatureRow {
  id: FeatureId;
  label: string;
  description: ReactNode;
}

const FEATURE_ROWS: FeatureRow[] = [
  {
    id: "platform-provider",
    label: `${getBrand().name} LLM provider`,
    description:
      "Add a built-in LLM provider, served by this installation and needing no API key, to Settings → Providers.",
  },
  {
    id: "interactive-artifacts",
    label: "Interactive artifacts",
    description:
      "Let buttons in a private HTML artifact send prompts to its agent's open chat. The agent replies in chat.",
  },
  {
    id: "advanced-connections",
    label: "Advanced connections",
    description:
      "See the pre-release connection catalog: Google services, Spotify, YouTube and custom client credentials.",
  },
  {
    id: "vm-sandboxes",
    label: "New sandbox runtime",
    description: (
      <>
        Create new agents on a runtime based on{" "}
        <a
          href="https://github.com/smol-machines/smolvm"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-foreground"
          onClick={(event) => event.stopPropagation()}
        >
          smolvm
        </a>
        . Agents start much faster and can run containers (Docker, Kubernetes).
        Existing agents keep their runtime until you migrate them.
      </>
    ),
  },
  {
    id: "agent-telemetry",
    label: "Agent telemetry",
    description:
      "See what each turn of a conversation did (its spans, its records and what the call cost) under the reply itself, and export telemetry from the session menu.",
  },
  {
    id: "chat-forms",
    label: "Chat forms",
    description:
      "Let agents put forms, choices and cards into their chat replies, for example during onboarding or a kit update, and send your answer back with one click.",
  },
  {
    id: "processes",
    label: "Processes panel",
    description:
      "See what runs in your agent, what keeps it awake, and what finished while you were away.",
  },
  {
    id: "custom-avatars",
    label: "Custom avatars",
    description:
      "Give an agent an emoji or an uploaded JPG or PNG as its avatar, in the UI and in Slack.",
  },
  {
    id: "new-layout",
    label: "New layout",
    description:
      "A sidebar of agent avatars beside your conversations, with pinned sessions and a dashboard Home. Turn it off to return to the current layout.",
  },
];

function FeatureRowCard({
  row,
  enabled,
  onToggle,
}: {
  row: FeatureRow;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  const descriptionId = useId();
  return (
    <label
      className={cn(
        CARD_SURFACE,
        "flex cursor-pointer items-start justify-between gap-4 p-4",
      )}
    >
      <span>
        <span className="block text-sm font-medium text-foreground">
          {row.label}
        </span>
        <span
          id={descriptionId}
          className="mt-0.5 block text-sm text-muted-foreground"
        >
          {row.description}
        </span>
      </span>
      <Switch
        checked={enabled}
        onCheckedChange={onToggle}
        label={row.label}
        describedBy={descriptionId}
      />
    </label>
  );
}

export function FeaturesTab() {
  const { data: flags } = useFeatures();
  const { data: install } = useInstallCapabilities();
  const setFeature = useSetFeature();

  return (
    <div>
      <PageHeader
        pictogram={<ErlenmeyerFlask aria-hidden />}
        title="Experimental features"
        description="Try features that are still in progress. Each switch changes only your own account."
      />

      <div className="flex flex-col gap-3">
        {FEATURE_ROWS.filter((row) => isFeatureOffered(row.id, install)).map(
          (row) => (
            <FeatureRowCard
              key={row.id}
              row={row}
              enabled={flags?.[row.id] ?? false}
              onToggle={(enabled) =>
                setFeature.mutate({ feature: row.id, enabled })
              }
            />
          ),
        )}
      </div>

      <SectionLabel spaced className="mt-8">
        Onboarding
      </SectionLabel>
      <ResetOnboardingCard />
    </div>
  );
}
