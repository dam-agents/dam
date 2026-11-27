import type { FeatureId } from "api-server-api";
import { useId } from "react";

import { CARD_SURFACE } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { getBrand } from "../../../brand.js";
import { useFeatures, useSetFeature } from "../api/queries.js";
import { type FeatureRow, featureRows } from "../lib/feature-rows.js";

function FeatureSwitch({
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

export function FeatureSwitches({ features }: { features: FeatureId[] }) {
  const { data: flags } = useFeatures();
  const setFeature = useSetFeature();
  const rows = featureRows(getBrand());

  return (
    <div className="flex flex-col gap-3">
      {features.map((id) => (
        <FeatureSwitch
          key={id}
          row={rows[id]}
          enabled={flags?.[id] ?? false}
          onToggle={(enabled) => setFeature.mutate({ feature: id, enabled })}
        />
      ))}
    </div>
  );
}
