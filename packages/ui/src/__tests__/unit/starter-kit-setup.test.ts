// TEST_OVERVIEW: the starter-kit setup form submits only when the name, a harness
// TEST_OVERVIEW: (unless the kit pins one), a provider and every required connection
// TEST_OVERVIEW: requirement are covered; the provider counts as a granted connection.
import type { StarterKitView } from "api-server-api";
import { describe, expect, test } from "vitest";

import {
  buildStarterKitApplyInput,
  describeTemplates,
  isProviderRequirement,
  isStarterKitSetupComplete,
  providerPolicyForKit,
  requirementStatuses,
  shortKitVersion,
  type StarterKitSetupDraft,
} from "../../modules/starter-kits/lib/setup.js";

const kit: Pick<StarterKitView, "id" | "template" | "connections"> = {
  id: "code-reviewer",
  template: undefined,
  connections: [
    { templates: ["github-app", "github-pat"], required: true },
    { templates: ["slack"], required: false },
  ],
};

const owned = [
  { id: "c-gh", templateId: "github-pat" },
  { id: "c-slack", templateId: "slack" },
  { id: "c-llm", templateId: "ibm-litellm" },
];

const complete: StarterKitSetupDraft = {
  name: " reviewer ",
  templateId: "claude-code",
  providerRef: { id: "c-llm" } as StarterKitSetupDraft["providerRef"],
  connectionIds: ["c-gh"],
  slackChannelId: " C123 ",
};

describe("requirementStatuses", () => {
  test("marks a requirement satisfied when any granted connection matches one of its templates", () => {
    expect(
      requirementStatuses(kit, complete, owned).map((s) => s.satisfied),
    ).toEqual([true, false]);
  });

  test("counts the provider connection as granted", () => {
    const providerKit = {
      connections: [
        { templates: ["ibm-litellm", "anthropic"], required: true },
      ],
    };
    expect(
      requirementStatuses(
        providerKit,
        { ...complete, connectionIds: [] },
        owned,
      )[0].satisfied,
    ).toBe(true);
  });
});

describe("isStarterKitSetupComplete", () => {
  test("requires name, harness, provider and every required connection", () => {
    expect(isStarterKitSetupComplete(kit, complete, owned)).toBe(true);
    for (const patch of [
      { name: "  " },
      { templateId: null },
      { providerRef: null },
      { connectionIds: [] },
    ]) {
      expect(
        isStarterKitSetupComplete(kit, { ...complete, ...patch }, owned),
      ).toBe(false);
    }
  });

  test("does not need a harness when the kit pins a template", () => {
    expect(
      isStarterKitSetupComplete(
        { ...kit, template: "nous" },
        { ...complete, templateId: null },
        owned,
      ),
    ).toBe(true);
  });
});

describe("buildStarterKitApplyInput", () => {
  test("trims the name, merges the provider into the grants and passes the Slack channel", () => {
    expect(buildStarterKitApplyInput(kit, complete, owned)).toEqual({
      kitId: "code-reviewer",
      name: "reviewer",
      templateId: "claude-code",
      connectionIds: ["c-gh", "c-llm"],
      slackChannelId: "C123",
    });
  });

  test("omits the harness for a pinned kit and the Slack channel when blank", () => {
    const input = buildStarterKitApplyInput(
      { ...kit, template: "nous" },
      { ...complete, templateId: null, slackChannelId: "" },
      owned,
    );
    expect(input).not.toHaveProperty("templateId");
    expect(input).not.toHaveProperty("slackChannelId");
  });

  test("refuses an incomplete draft", () => {
    expect(() =>
      buildStarterKitApplyInput(kit, { ...complete, providerRef: null }, owned),
    ).toThrow();
  });
});

describe("shortKitVersion", () => {
  test("shortens a full commit sha and leaves refs alone", () => {
    expect(shortKitVersion("4c525de66db6de74e9c8fd8342e443228c17aa69")).toBe(
      "4c525de",
    );
    expect(shortKitVersion("v1.4.0")).toBe("v1.4.0");
    expect(shortKitVersion("local")).toBe("local");
  });
});

describe("providerPolicyForKit", () => {
  const base = { recommended: "ibm-litellm" as const };
  test("narrows the provider picker to the kit's provider requirement", () => {
    const policy = providerPolicyForKit(
      { connections: [{ templates: ["anthropic", "openai"], required: true }] },
      base,
    );
    expect(policy).toEqual({
      allow: ["anthropic", "openai"],
      recommended: "anthropic",
    });
  });
  test("keeps the base recommendation when the kit allows it", () => {
    expect(
      providerPolicyForKit(
        {
          connections: [
            { templates: ["ibm-litellm", "anthropic"], required: true },
          ],
        },
        base,
      ).recommended,
    ).toBe("ibm-litellm");
  });
  test("falls back to the base policy when no requirement names a provider", () => {
    expect(providerPolicyForKit(kit, base)).toBe(base);
    expect(isProviderRequirement(kit.connections[0])).toBe(false);
    expect(isProviderRequirement({ templates: ["bob"], required: false })).toBe(
      true,
    );
  });
});

describe("describeTemplates", () => {
  test("names templates the catalog knows and falls back to the id", () => {
    const byId = new Map([["github-app", { name: "GitHub App" }]]);
    expect(describeTemplates(["github-app", "github-pat"], byId)).toBe(
      "GitHub App or github-pat",
    );
  });
});
