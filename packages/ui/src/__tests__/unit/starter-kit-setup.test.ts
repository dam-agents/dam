// TEST_OVERVIEW: the starter-kit setup submits only when the name and every required
// TEST_OVERVIEW: connection requirement are covered; requirements accept a template by its
// TEST_OVERVIEW: id or by the family its template declares, and the provider counts as granted.
import type { StarterKitView } from "api-server-api";
import { describe, expect, test } from "vitest";

import {
  buildStarterKitApplyInput,
  connectionRequirements,
  describeAccepts,
  isProviderRequirement,
  isStarterKitSetupComplete,
  kitScheduleCadence,
  ownedMatches,
  preselectedGrants,
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

const kit: Pick<
  StarterKitView,
  | "id"
  | "catalog"
  | "image"
  | "connections"
  | "seed"
  | "install"
  | "link"
  | "version"
  | "channels"
> = {
  id: "code-reviewer",
  catalog: "platform",
  version: "abc123",
  image: undefined,
  seed: undefined,
  install: undefined,
  channels: [],
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
  connectionIds: ["c-gh"],
  slackChannelIds: ["C123"],
  skippedSchedules: [],
  scheduleOverrides: [],
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
        { ...complete, connectionIds: ["c-llm"] },
        owned,
        templates,
      )[0].satisfied,
    ).toBe(true);
  });
});

describe("isStarterKitSetupComplete", () => {
  test("requires name and every required connection, but no provider", () => {
    expect(isStarterKitSetupComplete(kit, complete, owned, templates)).toBe(
      true,
    );
    for (const patch of [{ name: "  " }, { connectionIds: [] }]) {
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
});

describe("buildStarterKitApplyInput", () => {
  test("trims the name, dedupes the grants, passes Slack and skipped schedules", () => {
    expect(
      buildStarterKitApplyInput(
        kit,
        {
          ...complete,
          connectionIds: ["c-gh", "c-llm", "c-gh"],
          skippedSchedules: ["benchmark"],
        },
        owned,
        templates,
      ),
    ).toEqual({
      catalog: "platform",
      kitId: "code-reviewer",
      name: "reviewer",
      connectionIds: ["c-gh", "c-llm"],
      slackChannelIds: ["C123"],
      skipSchedules: ["benchmark"],
      scheduleOverrides: [],
    });
  });

  // TEST_SCENARIO: a kit from a link is created from the commit its page showed, so the apply names the link and that commit; a catalog kit names no link at all.
  test("names the link and the reviewed commit for a kit from a link", () => {
    const commit = "c".repeat(40);
    const linked = {
      ...kit,
      catalog: "link",
      version: commit,
      link: { url: "https://github.com/acme/shared-kit" },
    };
    expect(
      buildStarterKitApplyInput(linked, complete, owned, templates),
    ).toMatchObject({
      catalog: "link",
      link: { url: "https://github.com/acme/shared-kit", commit },
    });
    expect(
      buildStarterKitApplyInput(kit, complete, owned, templates),
    ).not.toHaveProperty("link");
  });

  test("refuses an incomplete draft", () => {
    expect(() =>
      buildStarterKitApplyInput(
        kit,
        { ...complete, name: "" },
        owned,
        templates,
      ),
    ).toThrow();
  });
});

describe("shortKitVersion", () => {
  test("shortens a full commit sha and leaves refs alone", () => {
    expect(shortKitVersion("4c525de66db6de74e9c8fd8342e443228c17aa69")).toBe(
      "4c525de66",
    );
    expect(shortKitVersion("v1.4.0")).toBe("v1.4.0");
    expect(shortKitVersion("local")).toBe("local");
  });
});

describe("connectionRequirements", () => {
  test("a provider requirement never reaches the connections section", () => {
    expect(
      connectionRequirements({
        connections: [
          { accepts: ["anthropic", "openai"], required: true },
          { accepts: ["github"], required: true },
        ],
      }).map((r) => r.accepts),
    ).toEqual([["github"]]);
  });

  test("recognises a provider requirement by its accepted template", () => {
    expect(isProviderRequirement(kit.connections[0])).toBe(false);
    expect(isProviderRequirement({ accepts: ["bob"], required: false })).toBe(
      true,
    );
  });
});

describe("families on the template view", () => {
  test("describeAccepts names a family, then a template, then falls back to the capitalised id", () => {
    expect(describeAccepts(["github", "github-app", "nope"], templates)).toBe(
      "GitHub or GitHub App or Nope",
    );
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
  test("renders a cron and an rrule as text with the timezone each runs in", () => {
    expect(
      kitScheduleCadence({
        name: "x",
        task: "t",
        enabled: true,
        cron: "*/5 8-21 * * 1-5",
      }),
    ).toBe(
      "Every 5 minutes, between 08:00 AM and 09:59 PM, Monday through Friday (UTC)",
    );
    expect(
      kitScheduleCadence({
        name: "z",
        task: "t",
        enabled: true,
        cron: "@hourly-ish",
      }),
    ).toBe("@hourly-ish (UTC)");
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
