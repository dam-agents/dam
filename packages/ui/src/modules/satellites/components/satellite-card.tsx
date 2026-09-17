import { TrashCan } from "@carbon/icons-react";
import type { SatelliteView } from "api-server-api";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

import { useAgentsList } from "../../agents/api/queries.js";
import {
  useGrantSatellite,
  useRemoveSatellite,
  useRevokeSatellite,
} from "../api/mutations.js";

function relativeAge(iso: string | null): string {
  if (iso === null) return "never connected";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

function StateDot({ satellite }: { satellite: SatelliteView }) {
  const tone = satellite.draining
    ? "bg-amber-500"
    : satellite.online
      ? "bg-emerald-500"
      : "bg-foreground/30";
  const label = satellite.draining
    ? "draining"
    : satellite.online
      ? "online"
      : `offline · last seen ${relativeAge(satellite.lastSeenAt)}`;
  return (
    <span className="flex items-center gap-1.5 text-xs text-foreground/70">
      <span className={`size-2 rounded-full ${tone}`} aria-hidden />
      {label}
    </span>
  );
}

interface Props {
  satellite: SatelliteView;
}

export function SatelliteCard({ satellite }: Props) {
  const agents = useAgentsList();
  const grant = useGrantSatellite();
  const revoke = useRevokeSatellite();
  const remove = useRemoveSatellite();
  const granted = new Set(satellite.grantedAgentIds);

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
            <StateDot satellite={satellite} />
          </div>
          <p className="mt-0.5 truncate text-xs text-foreground/60">
            {satellite.description ?? satellite.host ?? "—"}
            {satellite.activeJobs > 0 && ` · ${satellite.activeJobs} running`}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={remove.isPending}
          onClick={() => {
            if (
              window.confirm(
                `Remove ${satellite.name}? Commands already running on the machine are not stopped.`,
              )
            )
              remove.mutate(satellite.name);
          }}
          aria-label={`Remove ${satellite.name}`}
        >
          <TrashCan size={16} />
        </Button>
      </div>

      <ul className="mt-3 space-y-1">
        {satellite.commands.map((command) => (
          <li key={command.run} className="text-xs">
            <code className="text-foreground/80">{command.run}</code>
            {command.approval === "always" && (
              <span className="ml-2 text-foreground/50">needs approval</span>
            )}
          </li>
        ))}
      </ul>

      {agents.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="mb-1.5 text-xs text-foreground/60">
            Agents that can reach it
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {agents.map((agent) => (
              <label
                key={agent.id}
                className="flex items-center gap-1.5 text-xs"
              >
                <Checkbox
                  checked={granted.has(agent.id)}
                  disabled={grant.isPending || revoke.isPending}
                  onCheckedChange={(next) => {
                    const input = {
                      satellite: satellite.name,
                      agentId: agent.id,
                    };
                    if (next === true) grant.mutate(input);
                    else revoke.mutate(input);
                  }}
                />
                {agent.name ?? agent.id}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-foreground/50">
            A change takes effect when the agent's harness next starts.
          </p>
        </div>
      )}
    </div>
  );
}
