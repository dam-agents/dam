import { describe, expect, it } from "vitest";

import {
  buildCodingAgentSetupInput,
  buildCreateAgentInput,
  type CodingAgentSetupDraft,
  type CreateAgentDraft,
  hasPartialRegistryCredential,
  isCodingAgentSetupComplete,
  isCreateAgentDraftComplete,
} from "../../modules/agents/lib/create-agent-input.js";
import { EMPTY_REGISTRY_CREDENTIAL } from "../../modules/sandboxes/components/registry-credential-section.js";

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

const setup: CodingAgentSetupDraft = {
  name: "velvet-comet",
  templateId: "claude-code",
  customImage: "",
  providerRef: { id: "conn-provider" },
  connectionIds: ["conn-granted"],
  registryCredential: EMPTY_REGISTRY_CREDENTIAL,
};

const fullCredential = {
  server: "ghcr.io",
  username: "octocat",
  password: "pat",
};

describe("coding-agent setup completeness", () => {
  it("needs a name, a provider, and either a template or a custom image", () => {
    expect(isCodingAgentSetupComplete(setup)).toBe(true);
    expect(isCodingAgentSetupComplete({ ...setup, name: "  " })).toBe(false);
    expect(isCodingAgentSetupComplete({ ...setup, providerRef: null })).toBe(
      false,
    );
    expect(isCodingAgentSetupComplete({ ...setup, templateId: null })).toBe(
      false,
    );
    expect(
      isCodingAgentSetupComplete({
        ...setup,
        templateId: null,
        customImage: "ghcr.io/org/agent:latest",
      }),
    ).toBe(true);
  });

  // TEST_SCENARIO: a half-filled credential must not block a template image, whose pull never uses it.
  it("only lets a partial registry credential block a custom image", () => {
    const partial = {
      ...setup,
      registryCredential: { ...fullCredential, password: "" },
    };
    expect(hasPartialRegistryCredential(partial)).toBe(false);
    expect(isCodingAgentSetupComplete(partial)).toBe(true);

    const partialCustom = {
      ...partial,
      templateId: null,
      customImage: "ghcr.io/org/agent:latest",
    };
    expect(hasPartialRegistryCredential(partialCustom)).toBe(true);
    expect(isCodingAgentSetupComplete(partialCustom)).toBe(false);
  });
});

describe("buildCodingAgentSetupInput", () => {
  it("sends the template, the trusted preset, and the provider after the granted connections", () => {
    expect(
      buildCodingAgentSetupInput({ ...setup, name: " velvet-comet " }),
    ).toEqual({
      name: "velvet-comet",
      egressPreset: "trusted",
      templateId: "claude-code",
      appConnectionIds: ["conn-granted", "conn-provider"],
    });
  });

  it("sends a custom image instead of a template, and no credential until all three fields are set", () => {
    const custom = {
      ...setup,
      templateId: null,
      customImage: " ghcr.io/org/agent:latest ",
    };
    expect(buildCodingAgentSetupInput(custom)).toEqual({
      name: "velvet-comet",
      egressPreset: "trusted",
      image: "ghcr.io/org/agent:latest",
      appConnectionIds: ["conn-granted", "conn-provider"],
    });
    expect(
      buildCodingAgentSetupInput({
        ...custom,
        registryCredential: fullCredential,
      }),
    ).toMatchObject({ registryCredential: fullCredential });
  });

  // TEST_SCENARIO: a credential typed against a custom image must not leak once the user picks a template.
  it("drops a complete credential when the image reverts to a template", () => {
    expect(
      buildCodingAgentSetupInput({
        ...setup,
        registryCredential: fullCredential,
      }),
    ).not.toHaveProperty("registryCredential");
  });

  it("throws on an incomplete draft", () => {
    expect(() =>
      buildCodingAgentSetupInput({ ...setup, providerRef: null }),
    ).toThrow();
  });
});
