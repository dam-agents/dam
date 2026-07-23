import { describe, expect, it } from "vitest";

import {
  buildCreateAgentInput,
  type CreateAgentDraft,
  isCreateAgentDraftComplete,
} from "../../modules/agents/lib/create-agent-input.js";

const complete: CreateAgentDraft = {
  name: "swift-otter",
  templateId: "claude-code",
  providerRef: { id: "conn-123" },
  egressPreset: "trusted",
};

describe("create-agent draft completeness", () => {
  it("is complete only with a name, a template, and a provider", () => {
    expect(isCreateAgentDraftComplete(complete)).toBe(true);
    expect(isCreateAgentDraftComplete({ ...complete, name: "  " })).toBe(false);
    expect(isCreateAgentDraftComplete({ ...complete, templateId: null })).toBe(
      false,
    );
    expect(isCreateAgentDraftComplete({ ...complete, providerRef: null })).toBe(
      false,
    );
  });
});

describe("buildCreateAgentInput", () => {
  it("maps the provider to the sole app-connection grant and trims the name", () => {
    expect(
      buildCreateAgentInput({ ...complete, name: "  swift-otter " }),
    ).toEqual({
      name: "swift-otter",
      templateId: "claude-code",
      egressPreset: "trusted",
      appConnectionIds: ["conn-123"],
    });
  });

  it("carries the chosen egress preset through", () => {
    expect(
      buildCreateAgentInput({ ...complete, egressPreset: "all" }),
    ).toMatchObject({ egressPreset: "all" });
  });

  it("throws on an incomplete draft", () => {
    expect(() =>
      buildCreateAgentInput({ ...complete, providerRef: null }),
    ).toThrow();
  });
});
