import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { KubeObject } from "../../modules/agents/infrastructure/k8s.js";
import { createAgentTokenCodec } from "../../modules/agent-tokens/index.js";
import { mountCliTokenRoute } from "../../apps/harness-api-server/cli-token.js";
import {
  ANN_AGENT_KIND,
  LABEL_OWNER,
} from "../../modules/agents/infrastructure/labels.js";

/**
 * TEST_OVERVIEW: the one exchange an assistant makes for its own bearer. The
 * route is reachable only from the Agent's own machine, so what it must get
 * right is who it refuses: an Agent nobody owns, a plain Agent, and an owner the
 * install stopped offering assistants to — and that a minted token carries the
 * Agent and its owner, not whoever asked.
 */

const codec = createAgentTokenCodec("test-pepper");

function agent(kind: string | undefined, owner = "owner-1"): KubeObject {
  return {
    metadata: {
      labels: { [LABEL_OWNER]: owner },
      annotations: kind === undefined ? {} : { [ANN_AGENT_KIND]: kind },
    },
    spec: {},
  } as unknown as KubeObject;
}

function app(exists: KubeObject | null, opts: { flagOn?: boolean } = {}) {
  const mounted = new Hono();
  mountCliTokenRoute(mounted, {
    readAgent: async () => exists,
    mintToken: codec,
    featureOn: async () => opts.flagOn ?? true,
  });
  return mounted;
}

const post = (target: Hono, agentId = "agent-1") =>
  target.request(`/api/agents/${agentId}/cli-token`, { method: "POST" });

describe("the assistant's token exchange", () => {
  it("answers a token bound to the Agent and its owner", async () => {
    const response = await post(app(agent("assistant")));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      token: string;
      expiresAt: string;
    };
    expect(codec.read(body.token)).toMatchObject({
      agentId: "agent-1",
      ownerSub: "owner-1",
    });
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());
  });

  it("refuses an Agent that is not an assistant", async () => {
    const response = await post(app(agent(undefined)));
    expect(response.status).toBe(403);
  });

  it("refuses an owner the install no longer offers assistants to", async () => {
    const response = await post(app(agent("assistant"), { flagOn: false }));
    expect(response.status).toBe(403);
  });

  it("answers nothing for an Agent that is gone", async () => {
    const response = await post(app(null));
    expect(response.status).toBe(404);
  });
});
