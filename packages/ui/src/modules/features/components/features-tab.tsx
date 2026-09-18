import type { FeatureId } from "api-server-api";
import type { ReactNode } from "react";

import { CARD_SURFACE } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import {
  useFeatures,
  useInstallCapabilities,
  useSetFeature,
} from "../api/queries.js";

interface FeatureRow {
  id: FeatureId;
  label: string;
  description: ReactNode;
}

const FEATURE_ROWS: FeatureRow[] = [
  {
    id: "interactive-artifacts",
    label: "Interactive artifacts",
    description:
      "Lets buttons in a private HTML artifact send prompts to its agent's open chat. The agent replies in chat.",
  },
  {
    id: "advanced-connections",
    label: "Advanced connections",
    description:
      "Reveals the pre-release connection catalog (Google services, Spotify, YouTube, custom client-credentials).",
  },
  {
    id: "vm-sandboxes",
    label: "New sandbox runtime",
    description: (
      <>
        Use a new sandbox runtime based on{" "}
        <a
          href="https://github.com/smol-machines/smolvm"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-foreground"
          onClick={(event) => event.stopPropagation()}
        >
          smolvm
        </a>
        . Starts much faster, and supports running containers (Docker,
        Kubernetes).
      </>
    ),
  },
  {
    id: "satellites",
    label: "Satellites",
    description:
      "Reveals satellites — machines outside the platform that run a fixed set of approved commands for an agent. Set one up with the dam satellite serve command; this shows it here and lets you grant it to an agent.",
  },
  {
    id: "session-costs",
    label: "Session costs",
    description:
      "Shows each session’s LLM cost next to its timestamp in the sessions list, including child runs the session spawned, and adds a spend-by-session-type breakdown to the Usage tab.",
  },
];

function FeatureRowCard({
  row,
  enabled,
  unsupported,
  onToggle,
}: {
  row: FeatureRow;
  enabled: boolean;
  unsupported?: string;
  onToggle: (enabled: boolean) => void;
}) {
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
        <span className="mt-0.5 block text-sm text-muted-foreground">
          {row.description}
        </span>
        {unsupported && (
          <span className="mt-1 block text-sm text-warning-fg">
            {unsupported}
          </span>
        )}
      </span>
      <Switch checked={enabled} onCheckedChange={onToggle} />
    </label>
  );
}

export function FeaturesTab() {
  const { data: flags } = useFeatures();
  const { data: install } = useInstallCapabilities();
  const setFeature = useSetFeature();

  return (
    <div className="anim-in">
      <PageHeader
        title="Experimental features"
        description="Experimental features, toggled per user."
      />

      <div className="flex flex-col gap-3">
        {FEATURE_ROWS.map((row) => (
          <FeatureRowCard
            key={row.id}
            row={row}
            enabled={flags?.[row.id] ?? false}
            unsupported={
              row.id === "vm-sandboxes" && install?.virtualization === false
                ? "This install cannot run the new sandbox runtime, so agents keep the current one until an administrator enables virtualization."
                : undefined
            }
            onToggle={(enabled) =>
              setFeature.mutate({ feature: row.id, enabled })
            }
          />
        ))}
      </div>
    </div>
  );
}
