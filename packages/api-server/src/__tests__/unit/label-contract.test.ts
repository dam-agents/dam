import { describe, expect, it } from "vitest";
import { LABEL_AGENT_REF } from "../../modules/agents/infrastructure/labels.js";

describe("paired-pod label contract", () => {
  it("pins keys/values the controller's Go constants must equal", () => {
    expect(LABEL_AGENT_REF).toBe("agent-platform.ai/agent");
  });
});
