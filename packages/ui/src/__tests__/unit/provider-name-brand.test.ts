// TEST_OVERVIEW: each CurveBender preset is named by its template in every surface that names a provider: the user-keyed one keeps its "(own key)" suffix, the deployment's its "(shared)" one.
import { describe, expect, it } from "vitest";

import { providerNameFor } from "../../modules/provider-status/lib/provider-name.js";
import {
  providerName,
  providerRowName,
} from "../../modules/providers/lib/provider-rows.js";

describe("provider names", () => {
  // TEST_SCENARIO: the deployment CurveBender takes the preset's plain name and the user-keyed one keeps its suffix, in the provider row and everywhere else a provider is named by its template.
  it("names each CurveBender by its template", () => {
    const row = (templateId: string) => ({
      type: "curve-bender" as const,
      templateId,
      description: "",
    });
    const custom = row("curve-bender");
    const deployment = row("curve-bender-deployment");
    expect(providerRowName(custom)).toBe("CurveBender (own key)");
    expect(providerRowName(deployment)).toBe("CurveBender (shared)");
    expect(providerNameFor("curve-bender-deployment")).toBe(
      providerName("curve-bender", "curve-bender-deployment"),
    );
  });
});
