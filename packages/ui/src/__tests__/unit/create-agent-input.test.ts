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

  it("carries the chosen egress preset through", () => {
    expect(
      buildCreateAgentInput({ ...complete, egressPreset: "all" }),
    ).toMatchObject({ egressPreset: "all" });
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

const setup: CodingAgentSetupDraft = {
  name: "velvet-comet",
  templateId: "claude-code",
  customImage: "",
  providerRef: { id: "conn-provider" },
  connectionIds: ["conn-granted"],
  registryCredential: EMPTY_REGISTRY_CREDENTIAL,
  hibernationTimeoutMin: 60,
  vm: false,
};

const fullCredential = {
  server: "ghcr.io",
  username: "octocat",
  password: "pat",
};

describe("coding-agent setup completeness", () => {
  it("needs a name and either a template or a custom image, but no provider", () => {
    expect(isCodingAgentSetupComplete(setup)).toBe(true);
    expect(isCodingAgentSetupComplete({ ...setup, name: "  " })).toBe(false);
    expect(isCodingAgentSetupComplete({ ...setup, providerRef: null })).toBe(
      true,
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
  // TEST_SCENARIO: the create page's addressed-injection switch reaches the create only when it is on, so an agent created without it carries nothing new.
  it("asks for addressed injection only when the switch is on", () => {
    expect(
      buildCodingAgentSetupInput({ ...setup, requireConnectionAddress: true }),
    ).toMatchObject({ requireConnectionAddress: true });
    expect(
      buildCodingAgentSetupInput({ ...setup, requireConnectionAddress: false }),
    ).not.toHaveProperty("requireConnectionAddress");
  });

  it("sends the template, the trusted preset, and the provider after the granted connections", () => {
    expect(
      buildCodingAgentSetupInput({ ...setup, name: " velvet-comet " }),
    ).toEqual({
      name: "velvet-comet",
      egressPreset: "trusted",
      hibernationTimeoutMin: 60,
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
      hibernationTimeoutMin: 60,
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

  // TEST_SCENARIO: an untouched lifecycle choice must inherit the template's or the cluster's window, never the UI's own default.
  it("omits the idle window when the user made no lifecycle choice", () => {
    expect(
      buildCodingAgentSetupInput({ ...setup, hibernationTimeoutMin: null }),
    ).not.toHaveProperty("hibernationTimeoutMin");
  });

  it("throws on an incomplete draft", () => {
    expect(() => buildCodingAgentSetupInput({ ...setup, name: "" })).toThrow();
  });
});
