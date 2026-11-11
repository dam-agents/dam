/**
 * TEST_OVERVIEW: The catalog-shaped half of the rule a Session's model
 * resolves through. Whether a model a Session names still serves it depends on
 * the provider still being granted and on the provider's listing, read inside
 * the entries the Session's harness is offered; ids are compared the way the
 * Model Router resolves them, so a provider's own spelling of a model still
 * answers the Session that names it. A model that serves is chosen for a
 * Session with nothing of its own: the providers the default and the Session
 * name first, then the platform's preferred work model, then the first listed.
 */
import { describe, expect, it } from "vitest";
import type {
  CatalogEntry,
  CatalogProvider,
} from "../../modules/model-catalog/index.js";
import {
  automaticModelOf,
  modelUsableOn,
  type ModelSource,
} from "../../modules/acp/domain/catalog-model.js";

function source(opts: {
  status?: CatalogProvider["status"];
  ids: string[];
}): ModelSource {
  const entries = opts.ids.map(
    (id) => ({ alias: "cb", upstreamId: id }) as CatalogEntry,
  );
  return {
    providers: () => [
      { alias: "cb", status: opts.status ?? "listed" } as CatalogProvider,
    ],
    forHarness: () => entries,
  };
}

describe("modelUsableOn", () => {
  /** TEST_SCENARIO: A provider lists a model under its own spelling; the
   * Session that names it lowercased still serves on it, as the Model Router
   * resolves the name case-insensitively. */
  it("matches a listed upstream id case-insensitively", () => {
    const catalog = source({ ids: ["DeepSeek-V4-Flash"] });
    expect(
      modelUsableOn(catalog, "claude-code", "cb/deepseek-v4-flash", ["cb"]),
    ).toBe(true);
  });

  /** TEST_SCENARIO: A model its listed provider does not name is gone, and so
   * is one whose alias the agent no longer holds; a provider that has not
   * listed yet keeps every model usable, since nothing is known against it. */
  it("rules out a model a listed provider does not name", () => {
    const catalog = source({ ids: ["DeepSeek-V4-Flash"] });
    expect(modelUsableOn(catalog, "claude-code", "cb/glm-5-3", ["cb"])).toBe(
      false,
    );
    expect(modelUsableOn(catalog, "claude-code", "ibm/glm-5-3", ["cb"])).toBe(
      false,
    );
    const unlisted = source({ ids: [], status: "unavailable" });
    expect(modelUsableOn(unlisted, "claude-code", "cb/glm-5-3", ["cb"])).toBe(
      true,
    );
  });
});

describe("automaticModelOf", () => {
  /** TEST_SCENARIO: A Session with nothing of its own takes the preferred work
   * model of the provider its default names before another provider's first
   * listed model, and the platform's preferred work model before the order the
   * catalog happens to list. */
  it("prefers the named provider, then the platform's work model", () => {
    const catalog: ModelSource = {
      providers: () => [],
      forHarness: () =>
        [
          { alias: "ibm", upstreamId: "aws/claude-opus-4-8" },
          { alias: "ibm", upstreamId: "claude-sonnet-5" },
          { alias: "cb", upstreamId: "claude-opus-5-5" },
        ] as CatalogEntry[],
    };
    expect(
      automaticModelOf(catalog, "claude-code", ["ibm"], ["ibm", "cb"]),
    ).toBe("ibm/aws/claude-opus-4-8");
    expect(automaticModelOf(catalog, "claude-code", [], ["ibm", "cb"])).toBe(
      "cb/claude-opus-5-5",
    );
  });
});
