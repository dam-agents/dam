import { Callout } from "@/components/ui/callout";
import { Inset } from "@/components/ui/inset";
import { SectionLabel } from "@/components/ui/section-label";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useFeatures } from "../../features/api/queries.js";
import { useSatellites } from "../api/queries.js";
import { SatelliteCard } from "./satellite-card.js";

export function SatellitesSection() {
  const { data: features } = useFeatures();
  const enabled = features?.satellites ?? false;
  const satellitesQ = useSatellites(enabled);
  if (!enabled) return null;

  if (satellitesQ.isPending)
    return (
      <div className="mt-8">
        <SectionLabel spaced>Satellites</SectionLabel>
        <ListSkeleton />
      </div>
    );

  if (satellitesQ.isError && satellitesQ.data === undefined)
    return (
      <div className="mt-8">
        <SectionLabel spaced>Satellites</SectionLabel>
        <Callout tone="danger">
          Couldn&apos;t load satellites. Any that are connected keep running —
          this is the list, not the machines.
        </Callout>
      </div>
    );

  const satellites = satellitesQ.data ?? [];
  if (satellites.length === 0) return null;

  return (
    <div className="mt-8">
      <SectionLabel spaced>Satellites</SectionLabel>
      {satellitesQ.isError && (
        <p className="mb-2 text-xs text-danger">
          Couldn&apos;t refresh — showing what was last loaded.
        </p>
      )}
      <Inset className="flex flex-col gap-4">
        {satellites.map((satellite) => (
          <SatelliteCard key={satellite.name} satellite={satellite} />
        ))}
      </Inset>
    </div>
  );
}
