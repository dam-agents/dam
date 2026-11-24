import type { ConnectionView } from "api-server-api";
import { useMemo } from "react";

import { getBrand } from "../../../brand.js";
import { useChangeAgentConnections } from "../../agents/api/mutations.js";
import { useAgent, useAgentConnections } from "../../agents/api/queries.js";
import { useHoldsDamConnection } from "../../agents/hooks/use-holds-dam-connection.js";
import { holds } from "../../agents/lib/agent-permissions.js";
import { useAgentPageConnections } from "../../connections/api/queries.js";
import type { GrantDetails } from "../../connections/components/default-accounts-callout.js";
import {
  type SharedConnectionConfirm,
  useConfirmSharedConnection,
} from "../../connections/hooks/use-confirm-shared-connection.js";
import type { ConnectionAudience } from "../../connections/lib/connection-audience.js";
import {
  damAudienceSentence,
  damHoldWarns,
} from "../../connections/lib/dam-connection.js";
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
 * and the grant and revoke that change it. A grant or a revoke sends only its
 * change, which the server applies to the grants it holds, so a quick second
 * switch keeps the first and a failed write takes no other change with it. A
 * caller offers a
 * switch only once `loaded` is true and `failed` false, and only when
 * `managesConnections`, which waits for the Agent's access. The audience is
 * who else reaches the Agent, its editors and its shared channels, so a grant
 * can ask first, warning too while the Agent may hold the install's own
 * Connection. The Agent's Connections section and the chat's + menu both use
 * it.
 */
export function useAgentConnectionGrants(
  agentId: string,
): AgentConnectionGrants {
  const connectionsQ = useAgentPageConnections(agentId);
  const agent = useAgent(agentId);
  const access = agent?.access;
  const managesConnections = !!access && holds(access, "connections");
  const agentConnectionsQ = useAgentConnections(agentId);
  const changeConnections = useChangeAgentConnections();
  const sharedChannels = useSharedChannels(agentId);
  const editors = access?.role === "owner" ? access.editors : NO_EDITORS;
  const audience = useMemo(
    () => ({ editors, channels: sharedChannels }),
    [editors, sharedChannels],
  );
  const damWarns = damHoldWarns(useHoldsDamConnection(agent ?? null));
  const sharing = useConfirmSharedConnection(
    audience,
    damWarns
      ? damAudienceSentence(getBrand().name, "anyone who can drive it")
      : null,
  );

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

  const revokeGrants = (ids: readonly string[]) =>
    changeConnections.mutate({ agentId, grant: [], revoke: [...ids] });
  const toggleGrant = (id: string, on: boolean) => {
    if (on) changeConnections.mutate({ agentId, grant: [id], revoke: [] });
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
