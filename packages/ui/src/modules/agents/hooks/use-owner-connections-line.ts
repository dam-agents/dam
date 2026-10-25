import { useAgent } from "../api/queries.js";
import { ownerName } from "../lib/agent-permissions.js";
import {
  type OwnerConnectionsLine,
  ownerConnectionsLine,
} from "../lib/owner-connections.js";
import { useActingConnectionNames } from "./use-acting-connection-names.js";

export function useOwnerConnectionsLine(
  agentId: string | null,
): OwnerConnectionsLine | null {
  const agent = useAgent(agentId);
  const editor = agent?.access.role === "editor";
  const names = useActingConnectionNames(editor ? agentId : null);
  if (!agent || !editor || !names) return null;
  return ownerConnectionsLine(ownerName(agent.access), names);
}
