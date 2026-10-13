import type {
  CatalogProviderView,
  HarnessCatalogView,
} from "agent-runtime-api";
import { describe, expect, it } from "vitest";

import {
  catalogSettled,
  type ModelGroup,
  modelIndicatorLabel,
  sameModel,
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
  models: [],
});
const catalog = (...providers: CatalogProviderView[]): HarnessCatalogView => ({
  harness: "bob",
  routed: true,
  providers,
});

describe("catalogSettled", () => {
  /** TEST_SCENARIO: A grant the pod has not received yet is missing from
   * the catalog, and a provider still listing is unavailable: neither is
   * settled. A provider that serves another harness is unsupported, which is
   * final. With no grants an empty catalog is the answer; no read yet is not. */
  it("settles once every granted provider is listed or unsupported", () => {
    expect(catalogSettled(catalog(), ["conn-ibm"])).toBe(false);
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
      "aws/claude-opus-4-5 · IBM ETE LiteLLM Proxy",
    );
    expect(sameModel("claude/ibm/aws/x", "ibm/aws/x")).toBe(true);
    expect(sameModel("ibm/aws/x", null)).toBe(false);
  });
});
