import type { SatelliteView } from "api-server-api";

import { Callout } from "@/components/ui/callout";
import { SectionLabel } from "@/components/ui/section-label";

import { useStore } from "../../../store.js";
import { useAgents } from "../../agents/api/queries.js";
import { useRemoveSatellite } from "../api/mutations.js";

export function useRemoveSatelliteWithConfirm() {
  const remove = useRemoveSatellite();
  const showConfirm = useStore((s) => s.showConfirm);
  const agents = useAgents().data?.list;

  const confirmAndRemove = async (satellite: SatelliteView) => {
    const affected = (agents ?? [])
      .filter((a) => satellite.grantedAgentIds.includes(a.id))
      .map((a) => a.name);
    const ok = await showConfirm(
      <>
        <p>
          Agents lose its tools, and its job history is deleted. Commands
          already running on the machine are not stopped. A worker still serving
          it stops; start it again to register it anew.
        </p>
        {affected.length > 0 && (
          <Callout tone="muted" className="mt-4">
            <SectionLabel>Affected agents</SectionLabel>
            <ul className="mt-2 list-disc pl-5 text-sm text-foreground/90">
              {affected.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </Callout>
        )}
      </>,
      `Remove ${satellite.name}?`,
      { kind: "destructive", confirmLabel: "Remove satellite" },
    );
    if (ok) remove.mutate(satellite.name);
  };

  return {
    confirmAndRemove,
    removingName: remove.isPending ? (remove.variables ?? null) : null,
  };
}
