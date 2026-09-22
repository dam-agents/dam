import { TrashCan } from "@carbon/icons-react";
import type { SatelliteView } from "api-server-api";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { useRemoveSatellite } from "../api/mutations.js";
import { SatelliteGrants } from "./satellite-grants.js";
import { SatelliteState } from "./satellite-state.js";

function subtitle(satellite: SatelliteView): string {
  const parts = [
    satellite.description,
    satellite.host,
    satellite.activeJobs > 0 ? `${satellite.activeJobs} running` : null,
  ].filter((part): part is string => part !== null && part !== "");
  return parts.length > 0 ? parts.join(" · ") : "—";
}

export function SatelliteCard({ satellite }: { satellite: SatelliteView }) {
  const remove = useRemoveSatellite();
  const showConfirm = useStore((s) => s.showConfirm);

  const onRemove = async (): Promise<void> => {
    const confirmed = await showConfirm(
      <>
        Remove satellite{" "}
        <strong className="text-foreground">
          &quot;{satellite.name}&quot;
        </strong>
        ? Commands already running on the machine are not stopped — only the
        platform stops sending it work.
      </>,
      "Remove satellite",
      { kind: "destructive" },
    );
    if (confirmed) remove.mutate(satellite.name);
  };

  return (
    <div
      className="rounded-lg border border-border p-3"
      data-testid={`satellite-${satellite.name}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">
              {satellite.name}
            </span>
            <SatelliteState satellite={satellite} />
          </div>
          <p className="mt-0.5 truncate text-xs text-foreground/60">
            {subtitle(satellite)}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={remove.isPending}
          onClick={() => void onRemove()}
          aria-label={`Remove ${satellite.name}`}
        >
          <TrashCan size={16} />
        </Button>
      </div>

      <ul className="mt-3 space-y-1">
        {satellite.tools.map((tool) => (
          <li key={tool.name} className="text-xs">
            <code className="text-foreground/80">{tool.name}</code>
            {tool.title !== undefined && (
              <span className="ml-2 text-foreground/50">{tool.title}</span>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-foreground/50">
        These tools are what the machine reported. The platform stores them, it
        does not verify them.
      </p>

      <SatelliteGrants satellite={satellite} />
    </div>
  );
}
