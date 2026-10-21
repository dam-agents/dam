// TEST_OVERVIEW: the built-in provider is named by the install's brand in every surface, and the CurveBender presets by their template: the user-keyed one keeps its "(custom key)" suffix, the deployment's the plain name.
import { describe, expect, it, vi } from "vitest";

vi.mock("../../brand.js", () => ({ getBrand: () => ({ name: "Acme" }) }));

import { providerNameFor } from "../../modules/provider-status/lib/provider-name.js";
import {
  providerName,
  providerRowName,
} from "../../modules/providers/lib/provider-rows.js";
import { inheritedEnvs } from "../../modules/sandboxes/hooks/use-inherited-envs.js";
import { modelGroups } from "../../modules/sessions/lib/catalog-groups.js";
import { grantedProviderRefs } from "../../modules/sessions/lib/session-pair-options.js";

describe("provider names", () => {
  // TEST_SCENARIO: every surface that names a provider by its template still reads the brand for the built-in provider, and the deployment CurveBender takes the preset's plain name while the user-keyed one keeps its suffix.
  it("names the built-in provider by the brand and each CurveBender by its template", () => {
    const conn = { id: "p1", name: "Acme", templateId: "platform-llm" };
    const { owned } = grantedProviderRefs(["p1"], [conn]);

    expect({
      status: providerNameFor("platform-llm"),
      pair: owned[0]?.name,
      group: modelGroups({ providers: [] } as never, owned)[0]?.displayName,
      inherited: inheritedEnvs({
        agentEnv: [],
        apps: [
          {
            ...conn,
            contributions: [{ kind: "env", name: "X", placeholder: "x" }],
          },
        ] as never,
        appIdsSet: new Set(["p1"]),
        envVars: [],
      })[0]?.source,
    }).toEqual({
      status: "Acme",
      pair: "Acme",
      group: "Acme",
      inherited: { label: "Acme", kind: "provider" },
    });

    const row = (templateId: string) => ({
      type: "curve-bender" as const,
      templateId,
      description: "",
    });
    const custom = row("curve-bender");
    const deployment = row("curve-bender-deployment");
    expect(providerRowName(custom)).toBe("CurveBender custom key");
    expect(providerRowName(deployment)).toBe("CurveBender");
    expect(providerNameFor("curve-bender-deployment")).toBe(
      providerName("curve-bender", "curve-bender-deployment"),
    );
  });
});
