import type { Brand, FeatureId } from "api-server-api";
import { type ReactNode, useId } from "react";

import { CARD_SURFACE } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SectionLabel } from "@/components/ui/section-label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { getBrand } from "../../../brand.js";
import { ResetOnboardingCard } from "../../getting-started/components/reset-onboarding-card.js";
import {
  useFeatures,
  useInstallCapabilities,
  useSetFeature,
} from "../api/queries.js";
import { assistantFeatureRow } from "../lib/assistant-feature-row.js";
import { damConnectionFeatureRow } from "../lib/dam-connection-feature-row.js";
import { isFeatureOffered } from "../lib/visible-features.js";

interface FeatureRow {
  id: FeatureId;
  label: string;
  description: ReactNode;
}

/* UNIT_BOUNDARY_DESCRIPTION: the rows the tab offers, with the Connection that drives the install and the assistant last, both built from the brand. */
function featureRows(brand: Brand): FeatureRow[] {
  return [
    ...FEATURE_ROWS,
    damConnectionFeatureRow(brand),
    assistantFeatureRow(brand),
  ];
}

const FEATURE_ROWS: FeatureRow[] = [
  {
    id: "advanced-connections",
    label: "Advanced connections",
    description:
      "See the pre-release connection catalog: Google services, Spotify, YouTube and custom client credentials.",
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
    id: "environments",
    label: "Environments and kept sub-agents",
    description:
      "Let your agents run sandboxes of their own and keep them: Environments for other people and agents to open, such as one per pull request, and sub-agents kept after their result, which your agent can enter, give more work, run in parallel and continue a conversation with. Both sleep when unused and expire.",
  },
  {
    id: "hermes",
    label: "Hermes harness",
    description:
      "Offer Nous Research's Hermes Agent beside the other harnesses when you start a session, open a terminal or pick an agent's defaults, on agents whose image carries it.",
  },
  {
    id: "github-enterprise-hosts",
    label: "GitHub Enterprise hosts",
    description:
      "Pick which GitHub Enterprise host to connect to, and move a GitHub Enterprise sign-in to another host, on an install that offers more than one.",
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

  const brand = getBrand();
  const offeredRows = featureRows(brand).filter((row) =>
    isFeatureOffered(row.id, install),
  );

  return (
    <div>
      <PageHeader
        title="Experimental features"
        description="Try features that are still in progress. Each switch changes only your own account."
      />

      <div className="flex flex-col gap-3">
        {offeredRows.map((row) => (
          <FeatureRowCard
            key={row.id}
            row={row}
            enabled={flags?.[row.id] ?? false}
            onToggle={(enabled) =>
              setFeature.mutate({ feature: row.id, enabled })
            }
          />
        ))}
      </div>

      <SectionLabel spaced className="mt-8">
        Onboarding
      </SectionLabel>
      <ResetOnboardingCard />
    </div>
  );
}
