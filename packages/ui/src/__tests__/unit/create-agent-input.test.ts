import { describe, expect, it } from "vitest";

import {
  buildCreateAgentInput,
  type CreateAgentDraft,
  isCreateAgentDraftComplete,
} from "../../modules/agents/lib/create-agent-input.js";

const complete: CreateAgentDraft = {
  name: "swift-otter",
  egressPreset: "trusted",
  vm: false,
};

describe("create-agent draft completeness", () => {
  /** TEST_SCENARIO: Creating asks for no harness and no provider; the
   * platform grants the default provider and sessions choose the harness. */
  it("is complete with a name alone", () => {
    expect(isCreateAgentDraftComplete(complete)).toBe(true);
    expect(isCreateAgentDraftComplete({ ...complete, name: "  " })).toBe(false);
  });
});

describe("buildCreateAgentInput", () => {
  it("names neither a template nor a provider, and trims the name", () => {
    expect(
      buildCreateAgentInput({ ...complete, name: "  swift-otter " }),
    ).toEqual({ name: "swift-otter", egressPreset: "trusted" });
  });

  it("asks for a microVM only when chosen", () => {
    expect(buildCreateAgentInput({ ...complete, vm: true })).toMatchObject({
      vm: true,
    });
    expect(buildCreateAgentInput(complete)).not.toHaveProperty("vm");
  });

  it("throws on an incomplete draft", () => {
    expect(() => buildCreateAgentInput({ ...complete, name: "" })).toThrow();
  });
});
