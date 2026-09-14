// TEST_OVERVIEW: the starter-kit setup form submits only when the name, a harness
// TEST_OVERVIEW: (unless the kit brings its own image), a provider and every required
// TEST_OVERVIEW: connection requirement are covered; requirements accept a template by its
// TEST_OVERVIEW: id or by the family its template declares, and the provider counts as granted.
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
  type TemplateIndex,
  toggleSkipped,
} from "../../modules/starter-kits/lib/setup.js";

const GITHUB = { id: "github", title: "GitHub" };
const GHE = { id: "github-enterprise", title: "GitHub Enterprise" };
const templates: TemplateIndex = new Map([
  ["github-pat", { id: "github-pat", name: "GitHub PAT", family: GITHUB }],
  ["github-app", { id: "github-app", name: "GitHub App", family: GITHUB }],
  [
    "github-enterprise-pat",
    { id: "github-enterprise-pat", name: "GHE PAT", family: GHE },
  ],
  ["slack", { id: "slack", name: "Slack" }],
  ["ibm-litellm", { id: "ibm-litellm", name: "IBM LiteLLM" }],
]);

const kit: Pick<StarterKitView, "id" | "image" | "connections"> = {
  id: "code-reviewer",
  image: undefined,
  connections: [
    { accepts: ["github-app", "github-pat"], required: true },
    { accepts: ["slack"], required: false },
  ],
};

const owned = [
  { id: "c-gh", templateId: "github-pat", name: "bot token" },
  { id: "c-slack", templateId: "slack", name: "workspace" },
  { id: "c-llm", templateId: "ibm-litellm", name: "proxy" },
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
  test("marks a requirement satisfied when a granted connection's template is accepted", () => {
    expect(
      requirementStatuses(kit, complete, owned, templates).map(
        (s) => s.satisfied,
      ),
    ).toEqual([true, false]);
  });

  test("accepts a template through the family it declares", () => {
    const familyKit = {
      connections: [{ accepts: ["github"], required: true }],
    };
    expect(
      requirementStatuses(familyKit, complete, owned, templates)[0].satisfied,
    ).toBe(true);
    const gheOnly = {
      connections: [{ accepts: ["github-enterprise"], required: true }],
    };
    expect(
      requirementStatuses(gheOnly, complete, owned, templates)[0].satisfied,
    ).toBe(false);
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
        templates,
      )[0].satisfied,
    ).toBe(true);
  });
});

describe("isStarterKitSetupComplete", () => {
  test("requires name, harness, provider and every required connection", () => {
    expect(isStarterKitSetupComplete(kit, complete, owned, templates)).toBe(
      true,
    );
    for (const patch of [
      { name: "  " },
      { templateId: null },
      { providerRef: null },
      { connectionIds: [] },
    ]) {
      expect(
        isStarterKitSetupComplete(
          kit,
          { ...complete, ...patch },
          owned,
          templates,
        ),
      ).toBe(false);
    }
  });

  test("does not need a harness when the kit brings its own image", () => {
    expect(
      isStarterKitSetupComplete(
        { ...kit, image: { ref: "quay.io/acme/nous:1" } },
        { ...complete, templateId: null },
        owned,
        templates,
      ),
    ).toBe(true);
  });
});

describe("buildStarterKitApplyInput", () => {
  test("trims the name, merges the provider into the grants, passes Slack and skipped schedules", () => {
    expect(
      buildStarterKitApplyInput(
        kit,
        { ...complete, skippedSchedules: ["benchmark"] },
        owned,
        templates,
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

  test("omits the harness for a kit with its own image and the Slack channel when blank", () => {
    const input = buildStarterKitApplyInput(
      { ...kit, image: { ref: "quay.io/acme/nous:1" } },
      { ...complete, templateId: null, slackChannelId: "" },
      owned,
      templates,
    );
    expect(input).not.toHaveProperty("templateId");
    expect(input).not.toHaveProperty("slackChannelId");
  });

  test("refuses an incomplete draft", () => {
    expect(() =>
      buildStarterKitApplyInput(
        kit,
        { ...complete, providerRef: null },
        owned,
        templates,
      ),
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
    expect(
      providerPolicyForKit(
        { connections: [{ accepts: ["anthropic", "openai"], required: true }] },
        base,
      ),
    ).toEqual({ allow: ["anthropic", "openai"], recommended: "anthropic" });
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

describe("families on the template view", () => {
  test("describeAccepts names a family, then a template, then falls back to the id", () => {
    expect(describeAccepts(["github", "github-app", "nope"], templates)).toBe(
      "GitHub or GitHub App or nope",
    );
  });

  test("connect targets open a family page once, and a bare template opens its family preselected", () => {
    const targets = connectTargets(
      {
        accepts: ["github", "github-enterprise", "github-app", "slack"],
        required: true,
      },
      templates,
    );
    expect(targets.map((t) => [t.label, t.providerId, t.templateId])).toEqual([
      ["GitHub", "github", undefined],
      ["GitHub Enterprise", "github-enterprise", undefined],
      ["GitHub App", "github", "github-app"],
      ["Slack", "slack", "slack"],
    ]);
  });

  test("ownedMatches lists the owned connections a requirement accepts", () => {
    expect(
      ownedMatches(
        { accepts: ["github"], required: true },
        owned,
        templates,
      ).map((c) => c.id),
    ).toEqual(["c-gh"]);
    expect(
      ownedMatches(
        { accepts: ["slack"], required: false },
        owned,
        templates,
      ).map((c) => c.id),
    ).toEqual(["c-slack"]);
  });

  test("preselects the single owned match of a required requirement, never a suggested or ambiguous one", () => {
    const twoReqs = {
      connections: [
        { accepts: ["github"], required: true },
        { accepts: ["slack"], required: false },
      ],
    };
    expect(preselectedGrants(twoReqs, owned, [], templates)).toEqual(["c-gh"]);
    expect(preselectedGrants(twoReqs, owned, ["c-gh"], templates)).toEqual([]);
    const twoGithub = [
      ...owned,
      { id: "c-gh2", templateId: "github-app", name: "org app" },
    ];
    expect(preselectedGrants(twoReqs, twoGithub, [], templates)).toEqual([]);
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
