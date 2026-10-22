// TEST_OVERVIEW: the Inherited list on an agent's Environment vars section. Every env contribution of a granted provider or connection is listed with the provider's display name, and one the user overrides with a variable of the same name stays in the list marked shadowed, so the shadowing warning can name it.
import type { ConnectionView } from "api-server-api";
import { describe, expect, it } from "vitest";

import { inheritedEnvs } from "../../modules/sandboxes/hooks/use-inherited-envs.js";

const connection = (
  id: string,
  templateId: string,
  name: string,
): ConnectionView =>
  ({
    id,
    templateId,
    name,
    contributions: [{ kind: "env", name: "OPENAI_MODEL", placeholder: "m" }],
  }) as unknown as ConnectionView;

describe("inheritedEnvs", () => {
  it("keeps a contribution the user overrides, marked shadowed", () => {
    const items = inheritedEnvs({
      agentEnv: [],
      apps: [connection("c1", "custom-header", "my-headers")],
      appIdsSet: new Set(["c1"]),
      envVars: [{ name: "OPENAI_MODEL", value: "shadow" }],
    });
    expect(items).toEqual([
      {
        name: "OPENAI_MODEL",
        value: "m",
        source: { label: "my-headers", kind: "connection" },
        shadowed: true,
      },
    ]);
  });

  it("leaves out connections the agent was not granted", () => {
    expect(
      inheritedEnvs({
        agentEnv: [],
        apps: [connection("c1", "custom-header", "x")],
        appIdsSet: new Set(),
        envVars: [],
      }),
    ).toEqual([]);
  });
});
