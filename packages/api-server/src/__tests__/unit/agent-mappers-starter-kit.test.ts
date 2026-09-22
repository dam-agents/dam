// TEST_OVERVIEW: the kit stamps on an Agent — which kit it came from and when its onboarding finished — have to survive the trip from the Agent resource to the agent view. The onboarded stamp is what clears the Onboarding tag and the session badge; a view that drops it shows an agent as still onboarding forever, however many times the agent marks itself done.
import type { RuntimeFeatures } from "agent-runtime-api";
import { describe, expect, it } from "vitest";

import {
  assembleAgent,
  parseInfraAgent,
} from "../../modules/agents/infrastructure/agent-mappers.js";
import {
  ANN_STARTER_KIT,
  ANN_STARTER_KIT_ONBOARDED,
} from "../../modules/agents/infrastructure/labels.js";

const KIT = "curated/code-reviewer@528ca6114b40f23864c756f17f66b48cde785273";
const ONBOARDED_AT = "2026-09-16T09:13:17.410Z";

function agentView(annotations: Record<string, string>) {
  const infra = parseInfraAgent({
    metadata: { name: "agent-1", annotations },
    spec: { name: "kit agent" },
  } as Parameters<typeof parseInfraAgent>[0]);
  return assembleAgent(
    infra,
    [],
    [],
    60,
    false,
    undefined,
    {} as RuntimeFeatures,
    [],
    [],
  );
}

describe("kit stamps on the agent view", () => {
  it("carries the kit and the onboarded stamp through to the view", () => {
    const view = agentView({
      [ANN_STARTER_KIT]: KIT,
      [ANN_STARTER_KIT_ONBOARDED]: ONBOARDED_AT,
    });
    expect(view.starterKit).toBe(KIT);
    expect(view.starterKitOnboarded).toBe(ONBOARDED_AT);
  });

  it("leaves the stamp unset while onboarding is pending", () => {
    const view = agentView({ [ANN_STARTER_KIT]: KIT });
    expect(view.starterKit).toBe(KIT);
    expect(view.starterKitOnboarded).toBeUndefined();
  });
});
