import type { ConnectionView } from "api-server-api";

import { ToggleRow } from "@/components/ui/toggle-row";

import { connectionLabel } from "../../../connections/lib/connection-label.js";
import {
  grantBlockedReason,
  grantRivalry,
} from "../../../connections/lib/grant-rivals.js";
import type { AgentConnectionGrants } from "../../../sandboxes/hooks/use-agent-connection-grants.js";

export function QuickConnectionRow({
  connection,
  grants,
}: {
  connection: ConnectionView;
  grants: AgentConnectionGrants;
}) {
  const label = connectionLabel(connection);
  const on = grants.grantedIds.has(connection.id);
  const rivalry = on ? undefined : grantRivalry(connection, grants.granted);
  const handleToggle = async (next: boolean) => {
    if (next && !(await grants.sharing.confirm(connection))) return;
    grants.toggleGrant(connection.id, next);
  };

  if (!grants.managesConnections)
    return <ToggleRow title={label} control={null} />;
  return (
    <ToggleRow
      title={label}
      description={rivalry && grantBlockedReason(rivalry)}
      label={`${label} on this agent`}
      checked={on}
      disabled={rivalry !== undefined}
      onCheckedChange={(next) => void handleToggle(next)}
    />
  );
}
