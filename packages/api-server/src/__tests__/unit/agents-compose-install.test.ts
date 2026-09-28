// TEST_OVERVIEW: an agents module cannot be composed without the install's facts. The tRPC context once built one without the retention window, and every migration plan the UI got said the window was unknown. The facts are now one required argument, so a composition root that leaves them out does not compile.
import { describe, expect, it } from "vitest";

import { composeAgentsModule } from "../../modules/agents/compose.js";

type ComposeDeps = Parameters<typeof composeAgentsModule>[0];

describe("composeAgentsModule's install facts", () => {
  // TEST_SCENARIO: if the install facts became optional again, the expect-error directive below would fail the type check, which is the guard against a root forgetting them.
  it("requires the install facts from every composition root", () => {
    const withoutInstall: Omit<ComposeDeps, "install"> = {} as Omit<
      ComposeDeps,
      "install"
    >;
    // @ts-expect-error a composition root must pass the install facts
    const deps: ComposeDeps = withoutInstall;
    expect(deps).toBe(withoutInstall);
  });
});
