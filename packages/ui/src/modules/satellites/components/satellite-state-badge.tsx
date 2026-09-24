import type { SatelliteView } from "api-server-api";

import { Badge } from "@/components/ui/badge";
import { timeAgo } from "@/lib/format-time";

export function SatelliteStateBadge({
  satellite,
}: {
  satellite: SatelliteView;
}) {
  if (!satellite.online)
    return (
      <Badge variant="muted" className="shrink-0 font-normal">
        {satellite.lastSeenAt === null
          ? "Never connected"
          : `Offline · seen ${timeAgo(satellite.lastSeenAt)}`}
      </Badge>
    );
  return (
    <Badge variant="warning" className="shrink-0 font-normal">
      Shutting down
    </Badge>
  );
}
