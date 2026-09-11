// TEST_OVERVIEW: the starter-kit setup form submits only when the name, a harness
// TEST_OVERVIEW: (unless the kit pins one), a provider and every required connection
// TEST_OVERVIEW: requirement are covered; the provider counts as a granted connection.
import type { StarterKitView } from "api-server-api";
import { describe, expect, test } from "vitest";

import { narrowPolicyToTemplate } from "../../modules/sandboxes/lib/setup-policy.js";
import {
  buildStarterKitApplyInput,
  connectTargets,
  describeAccepts,
  isProviderRequirement,
  isStarterKitSetupComplete,
  kitScheduleCadence,
  ownedMatches,
  preselectedGrants,
  providerPolicyForKit,
  requirementStatuses,
  shortKitVersion,
  type StarterKitSetupDraft,
  toggleSkipped,
} from "../../modules/starter-kits/lib/setup.js";

const kit: Pick<StarterKitView, "id" | "template" | "connections"> = {
  id: "code-reviewer",
  template: undefined,
  connections: [
    { accepts: ["github-app", "github-pat"], required: true },
    { accepts: ["slack"], required: false },
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
  skippedSchedules: [],
};

describe("requirementStatuses", () => {
  test("marks a requirement satisfied when any granted connection matches one of its templates", () => {
    expect(
      requirementStatuses(kit, complete, owned).map((s) => s.satisfied),
    ).toEqual([true, false]);
  });

  test("counts the provider connection as granted", () => {
    const providerKit = {
      connections: [{ accepts: ["ibm-litellm", "anthropic"], required: true }],
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
    expect(
      buildStarterKitApplyInput(
        kit,
        { ...complete, skippedSchedules: ["benchmark"] },
        owned,
      ),
    ).toEqual({
      kitId: "code-reviewer",
      name: "reviewer",
      templateId: "claude-code",
      connectionIds: ["c-gh", "c-llm"],
      slackChannelId: "C123",
      skipSchedules: ["benchmark"],
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
      { connections: [{ accepts: ["anthropic", "openai"], required: true }] },
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
            { accepts: ["ibm-litellm", "anthropic"], required: true },
          ],
        },
        base,
      ).recommended,
    ).toBe("ibm-litellm");
  });
  test("falls back to the base policy when no requirement names a provider", () => {
    expect(providerPolicyForKit(kit, base)).toBe(base);
    expect(isProviderRequirement(kit.connections[0])).toBe(false);
    expect(isProviderRequirement({ accepts: ["bob"], required: false })).toBe(
      true,
    );
  });
});

describe("describeAccepts", () => {
  test("names families, then templates the catalog knows, then falls back to the id", () => {
    const byId = new Map([["github-app", { name: "GitHub App" }]]);
    expect(describeAccepts(["github", "github-app", "github-pat"], byId)).toBe(
      "GitHub or GitHub App or github-pat",
    );
  });
});

describe("connection families", () => {
  test("a family requirement is satisfied by any of its templates", () => {
    const familyKit = {
      connections: [{ accepts: ["github"], required: true }],
    };
    const draft = { ...complete, connectionIds: ["c-gh"], providerRef: null };
    expect(requirementStatuses(familyKit, draft, owned)[0].satisfied).toBe(
      true,
    );
    expect(
      requirementStatuses(familyKit, { ...draft, connectionIds: [] }, owned)[0]
        .satisfied,
    ).toBe(false);
  });

  test("connect targets open the family page once, and a bare template opens its family preselected", () => {
    const byId = new Map<string, { id: string; name: string }>([
      ["github-app", { id: "github-app", name: "GitHub App" }],
      ["slack", { id: "slack", name: "Slack" }],
    ]);
    const targets = connectTargets(
      {
        accepts: ["github", "github-enterprise", "github-app", "slack"],
        required: true,
      },
      byId as never,
    );
    expect(targets.map((t) => [t.label, t.providerId, t.templateId])).toEqual([
      ["GitHub", "github", undefined],
      ["GitHub Enterprise", "github-enterprise", undefined],
      ["GitHub App", "github", "github-app"],
      ["Slack", "slack", "slack"],
    ]);
  });
});

describe("narrowPolicyToTemplate", () => {
  const claudeCode = { providers: ["ibm-litellm", "anthropic"] as const };
  test("keeps only providers the template declares it can run on", () => {
    expect(
      narrowPolicyToTemplate({ recommended: "ibm-litellm" }, claudeCode),
    ).toEqual({
      allow: ["ibm-litellm", "anthropic"],
      recommended: "ibm-litellm",
    });
    expect(
      narrowPolicyToTemplate(
        { allow: ["openai", "anthropic"], recommended: "openai" },
        claudeCode,
      ),
    ).toEqual({ allow: ["anthropic"], recommended: "anthropic" });
    expect(
      narrowPolicyToTemplate(
        { allow: ["openai"], recommended: "openai" },
        claudeCode,
      ).allow,
    ).toEqual([]);
  });
  test("leaves the policy alone when the template declares no providers", () => {
    const base = { allow: ["bob" as const] };
    expect(narrowPolicyToTemplate(base, { providers: undefined })).toBe(base);
    expect(narrowPolicyToTemplate(base, null)).toBe(base);
  });
});

describe("schedules", () => {
  test("toggles a schedule in and out of the skipped set", () => {
    expect(toggleSkipped([], "a")).toEqual(["a"]);
    expect(toggleSkipped(["a", "b"], "a")).toEqual(["b"]);
  });
  test("renders a cron as-is and an rrule as text with its timezone", () => {
    expect(
      kitScheduleCadence({
        name: "x",
        task: "t",
        enabled: true,
        cron: "*/5 * * * *",
      }),
    ).toBe("*/5 * * * *");
    expect(
      kitScheduleCadence({
        name: "y",
        task: "t",
        enabled: false,
        rrule: "FREQ=WEEKLY;BYDAY=FR",
        timezone: "Europe/Prague",
      }),
    ).toMatch(/\(Europe\/Prague\)$/);
  });
});

describe("existing connections", () => {
  const ownedWithNames = [
    { id: "c-gh", templateId: "github-pat", name: "bot token" },
    { id: "c-gh2", templateId: "github-app", name: "org app" },
    { id: "c-slack", templateId: "slack", name: "workspace" },
  ];
  test("lists the owned connections a requirement accepts, expanding families", () => {
    expect(
      ownedMatches({ accepts: ["github"], required: true }, ownedWithNames).map(
        (c) => c.id,
      ),
    ).toEqual(["c-gh", "c-gh2"]);
    expect(
      ownedMatches({ accepts: ["slack"], required: false }, ownedWithNames).map(
        (c) => c.id,
      ),
    ).toEqual(["c-slack"]);
  });
  test("pre-selects the single owned match of a required requirement, never a suggested one or an ambiguous one", () => {
    const twoGithub = {
      connections: [
        { accepts: ["github"], required: true },
        { accepts: ["slack"], required: false },
      ],
    };
    expect(preselectedGrants(twoGithub, ownedWithNames, [])).toEqual([]);
    const oneGithub = ownedWithNames.filter((c) => c.id !== "c-gh2");
    expect(preselectedGrants(twoGithub, oneGithub, [])).toEqual(["c-gh"]);
    expect(preselectedGrants(twoGithub, oneGithub, ["c-gh"])).toEqual([]);
  });
});
