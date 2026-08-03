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
      "Reveals the pre-release connection catalog (Google services, Slack, Spotify, custom client-credentials) and the sandbox Channels section.",
  },
  {
    id: "vm-sandboxes",
    label: "VM sandboxes",
    description:
      "Adds the “Run as a virtual machine” switch to the create-sandbox wizard, revealing images that boot a full VM — systemd, docker and k3s inside the sandbox — instead of a container.",
  },
  {
    id: "session-costs",
    label: "Session costs",
    description:
      "Shows each session’s LLM cost next to its timestamp in the sessions list, including child runs the session spawned.",
  },
];

/** The hidden Features settings tab — per-user, per-feature toggles stored
 *  server-side so feature surfaces beyond the browser (e.g. agents' MCP
 *  tools) can be gated too. */
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
          <label
            key={row.id}
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
            <Switch
              checked={flags?.[row.id] ?? false}
              onCheckedChange={(enabled) =>
                setFeature.mutate({ feature: row.id, enabled })
              }
            />
          </label>
        ))}
      </div>
    </div>
  );
}
