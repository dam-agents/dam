import type { ConnectionView } from "api-server-api";
import { useMemo } from "react";

import { useSetAgentConnections } from "../../agents/api/mutations.js";
import { useAgent, useAgentConnections } from "../../agents/api/queries.js";
import { holds } from "../../agents/lib/agent-permissions.js";
import { useAgentPageConnections } from "../../connections/api/queries.js";
import type { GrantDetails } from "../../connections/components/default-accounts-callout.js";
import {
  type SharedConnectionConfirm,
  useConfirmSharedConnection,
} from "../../connections/hooks/use-confirm-shared-connection.js";
import type { ConnectionAudience } from "../../connections/lib/connection-audience.js";
import { useSharedChannels } from "./use-shared-channels.js";

const NO_EDITORS: readonly string[] = [];
const NO_CONNECTIONS: ConnectionView[] = [];

export interface AgentConnectionGrants {
  connections: ConnectionView[];
  granted: ConnectionView[];
  grantedIds: ReadonlySet<string>;
  grants: ReadonlyMap<string, GrantDetails>;
  loaded: boolean;
  failed: boolean;
  managesConnections: boolean;
  editors: readonly string[];
  audience: ConnectionAudience;
  sharing: SharedConnectionConfirm;
  toggleGrant: (id: string, on: boolean) => void;
  revokeGrants: (ids: readonly string[]) => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Which of the owner's Connections an Agent holds,
 * and the grant and revoke that change it. A grant or a revoke sends the whole
 * new list of the Agent's Connections, built from the list the Agent holds at
 * that moment. The audience is who else reaches the Agent, its editors and its
 * shared channels, so a grant can ask first. The Agent's Connections section
 * and the chat's + menu both use it.
 */
export function useAgentConnectionGrants(
  agentId: string,
): AgentConnectionGrants {
  const connectionsQ = useAgentPageConnections(agentId);
  const access = useAgent(agentId)?.access;
  const managesConnections = !access || holds(access, "connections");
  const agentConnectionsQ = useAgentConnections(agentId);
  const setConnections = useSetAgentConnections();
  const sharedChannels = useSharedChannels(agentId);
  const editors = access?.role === "owner" ? access.editors : NO_EDITORS;
  const audience = useMemo(
    () => ({ editors, channels: sharedChannels }),
    [editors, sharedChannels],
  );
  const sharing = useConfirmSharedConnection(audience);

  const grantedIds = useMemo(
    () =>
      new Set(
        agentConnectionsQ.data?.connections.map((c) => c.connectionId) ?? [],
      ),
    [agentConnectionsQ.data],
  );
  const grants = useMemo(
    () =>
      new Map(
        (agentConnectionsQ.data?.connections ?? []).map((c) => [
          c.connectionId,
          { grantedAt: c.grantedAt, preferred: c.preferred },
        ]),
      ),
    [agentConnectionsQ.data],
  );
  const connections = connectionsQ.data ?? NO_CONNECTIONS;
  const granted = useMemo(
    () => connections.filter((c) => grantedIds.has(c.id)),
    [connections, grantedIds],
  );

  const grantedNow = () =>
    agentConnectionsQ.data?.connections.map((c) => c.connectionId) ?? [];
  const revokeGrants = (ids: readonly string[]) =>
    setConnections.mutate({
      agentId,
      connectionIds: grantedNow().filter((x) => !ids.includes(x)),
    });
  const toggleGrant = (id: string, on: boolean) => {
    if (on)
      setConnections.mutate({
        agentId,
        connectionIds: [...new Set([...grantedNow(), id])],
      });
    else revokeGrants([id]);
  };

  return {
    connections,
    granted,
    grantedIds,
    grants,
    loaded: !connectionsQ.isPending && !agentConnectionsQ.isPending,
    failed: connectionsQ.isError || agentConnectionsQ.isError,
    managesConnections,
    editors,
    audience,
    sharing,
    toggleGrant,
    revokeGrants,
  };
}
