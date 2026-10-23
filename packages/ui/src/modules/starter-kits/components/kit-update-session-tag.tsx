import type { SessionView } from "api-server-api";

import { Badge } from "@/components/ui/badge";

import { useKitUpdate } from "../api/queries.js";
import { isKitUpdateSession } from "../lib/kit-update-session.js";

export function KitUpdateSessionTag({ session }: { session: SessionView }) {
  const update = useKitUpdate(session.agentId);
  if (!isKitUpdateSession(session, update?.pending ?? null)) return null;
  return (
    <Badge
      variant="kit"
      size="sm"
      className="shrink-0"
      title="This chat is bringing a newer version of the agent's starter kit in."
      data-testid="session-kit-update-badge"
    >
      Kit update
    </Badge>
  );
}
