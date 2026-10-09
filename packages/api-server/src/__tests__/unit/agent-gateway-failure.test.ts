// TEST_OVERVIEW: a crash-looping gateway leaves the agent pod ready, so the agent still reads as running; only gatewayFailure tells the user their egress is down. It must carry hard gateway failures and stay quiet while the gateway is merely starting, rolling or hibernated.
import type { RuntimeFeatures } from "agent-runtime-api";
import { toAgentView } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  assembleAgent,
  computeAgentState,
  parseInfraAgent,
} from "../../modules/agents/infrastructure/agent-mappers.js";

function agentWithGateway(
  reason: string,
  message: string,
  ready = { status: "True", reason: "AllPodsReady" },
) {
  return {
    metadata: { name: "a" },
    status: {
      conditions: [
        { type: "Ready", ...ready },
        { type: "AgentPodReady", status: "True", reason: "PodReady" },
        { type: "GatewayPodReady", status: "False", reason, message },
      ],
    },
  };
}

describe("gatewayFailure", () => {
  it("reports a crash-looping gateway on an agent that still runs", () => {
    const infra = parseInfraAgent(
      agentWithGateway("ContainerTerminated", "exited with code 1 (Error)", {
        status: "False",
        reason: "PodsNotReady",
      }),
    );
    expect(infra.gatewayFailure).toBe("exited with code 1 (Error)");
    expect(computeAgentState(infra)).toBe("running");
    const view = toAgentView(
      assembleAgent(
        infra,
        [],
        [],
        60,
        false,
        undefined,
        {} as RuntimeFeatures,
        [],
        [],
        { virtualizationEnabled: false, defaultMounts: [] },
      ),
    );
    expect(view.gatewayFailure).toBe("exited with code 1 (Error)");
  });

  it("reports a gateway stuck on a superseded revision", () => {
    const infra = parseInfraAgent(
      agentWithGateway("StuckOnSupersededRevision", "replacing it"),
    );
    expect(infra.gatewayFailure).toBe("replacing it");
  });

  it("stays unset while the gateway is still starting", () => {
    const infra = parseInfraAgent(agentWithGateway("PodNotReady", ""));
    expect(infra.gatewayFailure).toBeUndefined();
  });

  it("stays unset for an agent parked over budget", () => {
    const infra = parseInfraAgent(
      agentWithGateway("ContainerTerminated", "exited with code 1 (Error)", {
        status: "False",
        reason: "OverBudget",
      }),
    );
    expect(infra.gatewayFailure).toBeUndefined();
  });

  it("stays unset for a hibernated agent", () => {
    const infra = parseInfraAgent(
      agentWithGateway("ContainerTerminated", "exited with code 1 (Error)", {
        status: "False",
        reason: "Hibernated",
      }),
    );
    expect(infra.gatewayFailure).toBeUndefined();
  });
});
