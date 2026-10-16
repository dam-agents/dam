import type {
  CatalogProviderView,
  HarnessCatalogView,
} from "agent-runtime-api";
import { describe, expect, it } from "vitest";

import { settingsForModel } from "../../modules/sessions/components/session-settings-controls.js";
import {
  catalogSettled,
  type ModelGroup,
  modelGroups,
  modelIndicatorLabel,
  sameModel,
  sameSideGroups,
} from "../../modules/sessions/lib/catalog-groups.js";

/**
 * TEST_OVERVIEW: The model list asks the pod again until its catalog has
 * caught up with the agent's grants. An agent created with no provider, then
 * granted some, first reads an empty catalog; that read must not end the
 * asking, or the picker says no provider runs the harness for good.
 */
const provider = (
  connectionId: string,
  status: CatalogProviderView["status"],
): CatalogProviderView => ({
  connectionId,
  alias: connectionId,
  template: connectionId,
  displayName: connectionId,
  status,
  listedAt: null,
  native: false,
  models: [],
});
const modelOf = (name: string) => ({
  name,
  upstreamId: name.slice(name.indexOf("/") + 1),
  contextWindow: null,
  maxOutputTokens: null,
  reasoning: null,
  vision: null,
  prices: null,
  source: { limits: "none" as const, prices: "none" as const },
});
const catalog = (...providers: CatalogProviderView[]): HarnessCatalogView => ({
  harness: "bob",
  routed: true,
  providers,
});

describe("catalogSettled", () => {
  /** TEST_SCENARIO: A grant the pod has not received yet is missing from
   * the catalog, a revoked provider the pod still lists has not left it yet,
   * and a provider still listing is unavailable: none is settled. A provider
   * that serves another harness is unsupported, which is final. With no
   * grants an empty catalog is the answer; no read yet is not. */
  it("settles once every granted provider is listed or unsupported", () => {
    expect(catalogSettled(catalog(), ["conn-ibm"])).toBe(false);
    expect(catalogSettled(catalog(provider("conn-ibm", "listed")), [])).toBe(
      false,
    );
    expect(
      catalogSettled(catalog(provider("conn-ibm", "listed")), [
        "conn-ibm",
        "conn-cb",
      ]),
    ).toBe(false);
    expect(
      catalogSettled(catalog(provider("conn-ibm", "unavailable")), [
        "conn-ibm",
      ]),
    ).toBe(false);
    expect(
      catalogSettled(
        catalog(
          provider("conn-ibm", "listed"),
          provider("conn-oauth", "unsupported"),
        ),
        ["conn-ibm", "conn-oauth"],
      ),
    ).toBe(true);
    expect(catalogSettled(catalog(), [])).toBe(true);
    expect(catalogSettled(undefined, [])).toBe(false);
  });
});

describe("modelGroups", () => {
  /** TEST_SCENARIO: A provider just attached is granted before the pod has
   * it, so the catalog does not name it yet; the picker shows it after the
   * catalog's providers, never listed, rather than dropping it until the
   * pod catches up. Before the first catalog read there is nothing to show. */
  it("keeps a granted provider the catalog does not name yet", () => {
    const granted = [
      { id: "conn-oai", name: "My OpenAI", type: "openai" as const },
    ];
    expect(
      modelGroups(catalog(provider("conn-ibm", "listed")), granted),
    ).toMatchObject([
      { connectionId: "conn-ibm", status: "listed" },
      {
        connectionId: "conn-oai",
        alias: "openai",
        status: "unavailable",
        listedAt: null,
        models: [],
      },
    ]);
    expect(modelGroups(undefined, granted)).toEqual([]);
  });
});

describe("sameSideGroups", () => {
  const group = (connectionId: string, native: boolean, model: string) => ({
    ...modelGroups(catalog(provider(connectionId, "listed")))[0]!,
    native,
    models: [
      {
        name: model,
        upstreamId: model.slice(model.indexOf("/") + 1),
        contextWindow: null,
        maxOutputTokens: null,
        reasoning: null,
        vision: null,
        prices: null,
        source: { limits: "none" as const, prices: "none" as const },
      },
    ],
  });
  const groups = [
    group("conn-ibm", false, "ibm/gpt-5.5"),
    group("conn-bed", true, "bedrock/sonnet"),
  ];

  /** TEST_SCENARIO: A subagent model is offered from the session model's
   * side only. A session or schedule with no model runs on the router's
   * default, so it is offered the routed providers and never Bedrock. */
  it("offers the model's own side, and the router side for no model", () => {
    const ids = (model: string | null) =>
      sameSideGroups(groups, model).map((g) => g.connectionId);
    expect(ids("bedrock/sonnet")).toEqual(["conn-bed"]);
    expect(ids("ibm/gpt-5.5")).toEqual(["conn-ibm"]);
    expect(ids(null)).toEqual(["conn-ibm"]);
  });
});

describe("settingsForModel", () => {
  const capability = {
    name: "claude-code",
    harnessConfig: true,
    sessionModel: true,
    sessionSettings: ["effort", "subagentModel"],
    harnessConfigCatalog: {
      options: [
        {
          id: "effort",
          name: "Effort",
          category: "other",
          choices: [{ value: "high", name: "High" }],
        },
        {
          id: "subagentModel",
          name: "Subagent model",
          category: "model",
          choices: [],
        },
      ],
      modelConstraints: { haiku: { effort: [] } },
    },
  };
  const groups = [
    {
      ...modelGroups(catalog(provider("conn-ibm", "listed")))[0]!,
      native: false,
      models: [modelOf("ibm/claude-haiku-4-5"), modelOf("ibm/gpt-5.5")],
    },
    {
      ...modelGroups(catalog(provider("conn-bed", "listed")))[0]!,
      native: true,
      models: [modelOf("bedrock/sonnet")],
    },
  ];

  /** TEST_SCENARIO: Picking a new model keeps only the settings the runtime
   * would take with it: Haiku takes no effort, and a subagent model on the
   * other side of the router/native split is dropped; a value the catalog
   * does not list stays, since nothing can judge it. */
  it("drops what the new model cannot take and keeps the rest", () => {
    const settings = { effort: "high", subagentModel: "bedrock/sonnet" };
    expect(
      settingsForModel(capability, groups, "ibm/claude-haiku-4-5", settings),
    ).toEqual({});
    expect(
      settingsForModel(capability, groups, "ibm/gpt-5.5", settings),
    ).toEqual({
      effort: "high",
    });
    expect(
      settingsForModel(capability, groups, "bedrock/sonnet", settings),
    ).toEqual(settings);
    expect(
      settingsForModel(capability, groups, "ibm/gpt-5.5", {
        subagentModel: "cb/unlisted",
      }),
    ).toEqual({ subagentModel: "cb/unlisted" });
  });
});

describe("modelIndicatorLabel", () => {
  /** TEST_SCENARIO: Claude Code's catalog names models as it sees them
   * (`claude/ibm/aws/…`, lowercased) while the session stores the plain
   * `ibm/aws/…`; the label under the composer still finds the model and
   * names its provider, as it does on every other harness. */
  it("finds a session's model in Claude Code's prefixed catalog", () => {
    const groups: ModelGroup[] = [
      {
        connectionId: "conn-ibm",
        alias: "ibm",
        displayName: "IBM ETE LiteLLM Proxy",
        status: "listed" as const,
        listedAt: null,
        native: false,
        models: [
          {
            name: "claude/ibm/aws/claude-opus-4-5",
            upstreamId: "aws/claude-opus-4-5",
            contextWindow: null,
            maxOutputTokens: null,
            reasoning: null,
            vision: null,
            prices: null,
            source: { limits: "none" as const, prices: "none" as const },
          },
        ],
      },
    ];
    expect(modelIndicatorLabel(groups, "ibm/aws/claude-opus-4-5")).toBe(
      "aws/claude-opus-4-5 (IBM ETE LiteLLM Proxy)",
    );
    expect(sameModel("claude/ibm/aws/x", "ibm/aws/x")).toBe(true);
    expect(sameModel("ibm/aws/x", null)).toBe(false);
  });
});
