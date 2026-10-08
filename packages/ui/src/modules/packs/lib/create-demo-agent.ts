import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { getDemoFixtures } from "../data/pack-demo-fixtures.js";
import type { Pack } from "../data/packs.js";
import { insertAgentIntoCache } from "./mock-create-from-pack.js";

export function createDemoAgent(pack: Pack): string {
  const agentId = `demo-${pack.id}`;

  const harnessSlot = [...pack.included, ...pack.required].find(
    (s) => s.kind === "harness",
  );
  const templateId = harnessSlot?.templateId ?? null;

  const agent: AgentView = {
    id: agentId,
    name: pack.name,
    templateId,
    templateUpdate: null,
    image: templateId ? `ghcr.io/placeholder/${templateId}:latest` : "",
    description: pack.tagline,
    hibernationTimeoutMin: 60,
    grantedSecretIds: [],
    grantedConnectionIds: [],
    state: "running",
    error: undefined,
    stopRequested: false,
    overBudget: false,
    size: { cpu: "2000m", memory: "2Gi" },
    contributionFailures: [],
    channels: [],
    kbTemplateId: null,
    spawnedBy: null,
    features: { liveUpdates: true },
  };

  insertAgentIntoCache(agent);

  const fixtures = getDemoFixtures(pack.id);
  if (fixtures) {
    seedDemoCaches(agentId, fixtures);
  }

  useStore.getState().setDemoAgent(pack.id, agentId);
  return agentId;
}

function seedDemoCaches(
  _agentId: string,
  fixtures: NonNullable<ReturnType<typeof getDemoFixtures>>,
): void {
  void fixtures;
}
