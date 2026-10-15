import { useQuery } from "@tanstack/react-query";

import { formatDateTime } from "@/lib/format-time";

import { trpc } from "../../../trpc.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: how many of the person's agents still run an
 * image older than their template's; the old runtime path can be retired
 * once this reads zero everywhere.
 */
export function RuntimeFleetNote() {
  const { data } = useQuery({
    ...trpc.agents.runtimeFleet.queryOptions(),
    staleTime: 60_000,
    retry: false,
  });
  if (!data || data.outdated.length === 0) return null;
  return (
    <section className="mb-8 text-sm text-muted-foreground">
      <p>
        {data.outdated.length === 1
          ? "1 agent runs"
          : `${data.outdated.length} agents run`}{" "}
        an image older than its template ({data.onCurrent} on the current one).
        Each picks up the current image at its next upgrade.
      </p>
      <ul className="mt-2 flex flex-col gap-1">
        {data.outdated.map((a) => (
          <li key={a.agentId} className="truncate">
            <span className="text-foreground">{a.name}</span> · {a.image} ·{" "}
            {a.lastHello
              ? `last hello ${formatDateTime(a.lastHello)}`
              : "never said hello"}
          </li>
        ))}
      </ul>
    </section>
  );
}
