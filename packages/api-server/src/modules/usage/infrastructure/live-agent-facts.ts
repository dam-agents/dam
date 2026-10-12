import type { LiveAgentFact } from "../domain/analytics-report.js";

type AgentObjectShape = {
  metadata?: { name?: string };
  spec?: unknown;
};

type AgentSpecShape = {
  resources?: { limits?: { cpu?: string; memory?: string } };
  hibernationTimeout?: string;
  storageSize?: string;
  grantedConnectionIds?: string[];
};

export function toLiveAgentFact(obj: AgentObjectShape): LiveAgentFact | null {
  const id = obj.metadata?.name;
  if (!id) return null;
  const spec = (obj.spec ?? {}) as AgentSpecShape;
  return {
    id,
    cpu: spec.resources?.limits?.cpu,
    memory: spec.resources?.limits?.memory,
    hibernationTimeout: spec.hibernationTimeout,
    storageSize: spec.storageSize,
    grantedConnectionIds: spec.grantedConnectionIds ?? [],
  };
}
