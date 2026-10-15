// TEST_OVERVIEW: the UI names a provider by its Settings name, not the connection's own name, and a session pair reads as model then provider in brackets; with no model chosen it reads as the provider, and with neither as the harness.
import { describe, expect, it } from "vitest";

import {
  grantedProviderRefs,
  modelProviderLabel,
} from "../../modules/sessions/lib/session-pair-options.js";

describe("provider labels", () => {
  // TEST_SCENARIO: a connection the owner named "bob" still reads as Bob Shell, the name Settings / Providers shows.
  it("names a provider connection by its Settings name", () => {
    const { owned } = grantedProviderRefs(
      [],
      [{ id: "c1", name: "bob", templateId: "bob" }],
    );
    expect(owned[0]?.name).toBe("Bob Shell");
  });

  // TEST_SCENARIO: the trigger shows model (provider), and drops what is missing instead of inventing a model.
  it("reads model (provider), else whichever is known", () => {
    expect(modelProviderLabel("glm", "Curve", "Pi")).toBe("glm (Curve)");
    expect(modelProviderLabel(null, "Curve", "Pi")).toBe("Curve");
    expect(modelProviderLabel("glm", undefined, "Pi")).toBe("glm");
    expect(modelProviderLabel(null, undefined, "Pi")).toBe("Pi");
  });
});
