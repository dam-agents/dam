// TEST_OVERVIEW: who may publish a knowledge base, across the move to kits. A
// TEST_OVERVIEW: kit declares the roots and create stamps them; an agent made
// TEST_OVERVIEW: before kits carries only the old kind and template. Both must
// TEST_OVERVIEW: keep the capability — the annotation an agent happens to carry
// TEST_OVERVIEW: is history, not a statement about what it can do — and an agent
// TEST_OVERVIEW: that publishes nothing must not acquire it.
import { describe, expect, it } from "vitest";

import { resolveAgent } from "../../apps/harness-api-server/agent-auth.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import {
  ANN_AGENT_KIND,
  ANN_KB_SHARE_ROOTS,
  ANN_KB_TEMPLATE,
  LABEL_OWNER,
} from "../../modules/agents/infrastructure/labels.js";
import { legacyShareRoots } from "../../modules/kb-shares/domain/legacy-roots.js";

function k8sWith(annotations: Record<string, string>): K8sClient {
  return {
    getCustomObject: async () => ({
      metadata: {
        name: "agent-1",
        uid: "uid-1",
        labels: { [LABEL_OWNER]: "owner-1" },
        annotations,
      },
      spec: {},
    }),
  } as unknown as K8sClient;
}

describe("who may publish a knowledge base", () => {
  it("gives a kit-created agent the roots its kit declared", async () => {
    const agent = await resolveAgent(
      k8sWith({ [ANN_KB_SHARE_ROOTS]: "wiki, notes" }),
      "agent-1",
    );
    expect(agent?.kbShareRoots).toEqual(["wiki", "notes"]);
  });

  // TEST_SCENARIO: the knowledge bases that exist today were stamped with a kind and a template id, never with roots. They have live shares, so losing the capability would stop those publishing — the fallback is what makes the move to kits need no migration.
  it("keeps the capability for an agent stamped before kits", async () => {
    const agent = await resolveAgent(
      k8sWith({
        [ANN_AGENT_KIND]: "knowledge-base",
        [ANN_KB_TEMPLATE]: "plain-wiki",
      }),
      "agent-1",
    );
    expect(agent?.kbShareRoots).toEqual(["wiki", "sources"]);
  });

  // TEST_SCENARIO: a knowledge base whose template the platform no longer ships still has to publish something rather than nothing, because its share already exists.
  it("falls back to a usable root for a template it no longer knows", async () => {
    const agent = await resolveAgent(
      k8sWith({
        [ANN_AGENT_KIND]: "knowledge-base",
        [ANN_KB_TEMPLATE]: "retired-wiki",
      }),
      "agent-1",
    );
    expect(agent?.kbShareRoots).toEqual(["wiki"]);
    expect(legacyShareRoots(undefined)).toEqual(["wiki"]);
  });

  // TEST_SCENARIO: the capability is granted by what an agent publishes, so an ordinary agent must not pick it up. The MCP endpoint registers the sharing tools on exactly this field being set.
  it("withholds it from an agent that publishes nothing", async () => {
    const plain = await resolveAgent(k8sWith({}), "agent-1");
    expect(plain?.kbShareRoots).toBeUndefined();

    const experiment = await resolveAgent(
      k8sWith({ [ANN_AGENT_KIND]: "experiment" }),
      "agent-1",
    );
    expect(experiment?.kbShareRoots).toBeUndefined();
  });
});
