import type { FeatureId } from "api-server-api";

import { Switch } from "@/components/ui/switch";

import { useFeatures, useSetFeature } from "../api/queries.js";

interface FeatureRow {
  id: FeatureId;
  label: string;
  description: string;
}

const FEATURE_ROWS: FeatureRow[] = [
  {
    id: "experiments",
    label: "Experiments",
    description:
      "Race several agents against one goal and compare their scored candidates. Adds the Experiments destination.",
  },
  {
    id: "advanced-connections",
    label: "Advanced connections",
    description:
      "Reveals the pre-release connection catalog (Google services, Slack, Spotify, custom client-credentials) and the Channels settings tab.",
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
      <h2 className="mb-1 text-[24px] font-semibold tracking-[-0.65px] text-foreground md:text-[28px]">
        Experimental features
      </h2>
      <p className="mb-6 text-[14px] text-foreground/80">
        Experimental features, toggled per user.
      </p>

      <div className="flex flex-col gap-3">
        {FEATURE_ROWS.map((row) => (
          <label
            key={row.id}
            className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-border bg-card p-4"
          >
            <span>
              <span className="block text-[14px] font-medium text-foreground">
                {row.label}
              </span>
              <span className="mt-0.5 block text-[13px] text-muted-foreground">
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
