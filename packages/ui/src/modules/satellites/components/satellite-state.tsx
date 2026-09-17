import type { SatelliteView } from "api-server-api";

import { timeAgo } from "@/lib/format-time";
import { cn } from "@/lib/utils";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The one line that says whether a machine is
 * reachable. Offline is the state a user needs a time for — a satellite that has
 * been quiet for two minutes is a blip, and one quiet for two days is gone — so
 * only that branch carries one, and it comes from the shared formatter rather
 * than a second rounding of the same idea.
 */
export function SatelliteState({ satellite }: { satellite: SatelliteView }) {
  const tone = !satellite.online
    ? "bg-foreground/30"
    : satellite.draining
      ? "bg-amber-500"
      : "bg-emerald-500";

  const label = !satellite.online
    ? satellite.lastSeenAt === null
      ? "never connected"
      : `offline · last seen ${timeAgo(satellite.lastSeenAt)}`
    : satellite.draining
      ? "draining"
      : "online";

  return (
    <span className="flex items-center gap-1.5 text-xs text-foreground/70">
      <span className={cn("size-2 rounded-full", tone)} aria-hidden />
      {label}
    </span>
  );
}
