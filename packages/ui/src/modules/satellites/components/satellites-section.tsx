import { Inset } from "@/components/ui/inset";
import { SectionLabel } from "@/components/ui/section-label";

import { useSatellites } from "../api/queries.js";
import { SatelliteCard } from "./satellite-card.js";

export function SatellitesSection() {
  const satellitesQ = useSatellites();
  const satellites = satellitesQ.data ?? [];
  if (satellitesQ.isPending || satellites.length === 0) return null;

  return (
    <div className="mt-8">
      <SectionLabel spaced>Satellites</SectionLabel>
      <Inset className="flex flex-col gap-4">
        {satellites.map((satellite) => (
          <SatelliteCard key={satellite.name} satellite={satellite} />
        ))}
      </Inset>
    </div>
  );
}
