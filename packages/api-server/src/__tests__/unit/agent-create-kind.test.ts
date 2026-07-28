import { describe, expect, it } from "vitest";
import { agentCreateInputSchema, agentKindSchema } from "api-server-api";

describe("agents.create input schema", () => {
  it("strips kind and kbTemplateId — only an owning module's create path may mark an agent", () => {
    const parsed = agentCreateInputSchema.parse({
      name: "my-agent",
      image: "quay.io/example/claude-code:latest",
      kind: "knowledge-base",
      kbTemplateId: "llm-wiki",
    });
    expect("kind" in parsed).toBe(false);
    expect("kbTemplateId" in parsed).toBe(false);
  });

  it("strips every kind, so no marked agent can skip its Install Command", () => {
    for (const kind of agentKindSchema.options) {
      const parsed = agentCreateInputSchema.parse({
        name: "my-agent",
        image: "quay.io/example/claude-code:latest",
        kind,
      });
      expect("kind" in parsed).toBe(false);
    }
  });
});
