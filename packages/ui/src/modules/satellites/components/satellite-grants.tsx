import type { SatelliteView } from "api-server-api";

import { CheckboxItem } from "@/components/ui/checkbox";
import { TextSkeleton } from "@/components/ui/text-skeleton";

import { useAgents } from "../../agents/api/queries.js";
import { useGrantSatellite, useRevokeSatellite } from "../api/mutations.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The per-Agent reach of one Satellite. A toggle
 * disables only the row it is working on, because disabling the whole set would
 * make one slow grant look like the panel had failed; and an agent list still
 * loading renders as loading rather than as an owner with no agents, which is
 * the same picture for two very different situations.
 */
export function SatelliteGrants({ satellite }: { satellite: SatelliteView }) {
  const agentsQ = useAgents();
  const grant = useGrantSatellite();
  const revoke = useRevokeSatellite();
  const granted = new Set(satellite.grantedAgentIds);

  if (agentsQ.isPending)
    return (
      <div className="mt-3 border-t border-border pt-3">
        <TextSkeleton width="10rem" />
      </div>
    );

  if (agentsQ.isError)
    return (
      <div className="mt-3 border-t border-border pt-3">
        <p className="text-xs text-danger">
          Couldn&apos;t load your agents, so this satellite&apos;s reach is not
          shown. Whatever was granted still holds.
        </p>
      </div>
    );

  const agents = agentsQ.data?.list ?? [];
  if (agents.length === 0) return null;

  const busyFor = (agentId: string): boolean =>
    (grant.isPending && grant.variables?.agentId === agentId) ||
    (revoke.isPending && revoke.variables?.agentId === agentId);

  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="mb-1.5 text-xs text-foreground/60">
        Agents that can reach it
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {agents.map((agent) => (
          <CheckboxItem
            key={agent.id}
            className="w-auto items-center"
            labelClassName="text-xs"
            label={agent.name ?? agent.id}
            checked={granted.has(agent.id)}
            disabled={busyFor(agent.id)}
            onCheckedChange={(next) => {
              const input = { satellite: satellite.name, agentId: agent.id };
              if (next === true) grant.mutate(input);
              else revoke.mutate(input);
            }}
          />
        ))}
      </div>
      <p className="mt-2 text-xs text-foreground/50">
        A change takes effect when the agent&apos;s harness next starts.
      </p>
    </div>
  );
}
