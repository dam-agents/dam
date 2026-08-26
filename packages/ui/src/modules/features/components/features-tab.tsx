import type { FeatureId } from "api-server-api";

import { CARD_SURFACE } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { useFeatures, useSetFeature } from "../api/queries.js";

interface FeatureRow {
  id: FeatureId;
  label: string;
  description: string;
}

const FEATURE_ROWS: FeatureRow[] = [
  {
    id: "advanced-connections",
    label: "Advanced connections",
    description:
      "Reveals the pre-release connection catalog (Google services, Spotify, YouTube, GitHub App installations, custom client-credentials).",
  },
  {
    id: "vm-sandboxes",
    label: "VM sandboxes",
    description:
      "Reveals images that boot a full VM — systemd, docker and k3s inside the sandbox — instead of a container, in the coding agent’s image list.",
  },
  {
    id: "session-costs",
    label: "Session costs",
    description:
      "Shows each session’s LLM cost next to its timestamp in the sessions list, including child runs the session spawned.",
  },
  {
    id: "interactive-artifacts",
    label: "Interactive artifacts",
    description:
      "Lets a private HTML page ask the agent that published it to do something, with the answer landing back in the page. An interactive page can never be shared.",
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
      </span>
      <Switch checked={enabled} onCheckedChange={onToggle} />
    </label>
  );
}

export function FeaturesTab() {
  const { data: flags } = useFeatures();
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
            onToggle={(enabled) =>
              setFeature.mutate({ feature: row.id, enabled })
            }
          />
        ))}
      </div>
    </div>
  );
}
