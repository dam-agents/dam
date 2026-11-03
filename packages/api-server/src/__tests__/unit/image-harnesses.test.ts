import { readFileSync } from "node:fs";
import type { HarnessCapability } from "agent-runtime-api";
import {
  harnessCatalogConfigSchema,
  harnessFits,
  providerTypeForTemplateId,
  withImageHarnesses,
} from "api-server-api";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { resolveFirePair } from "../../modules/harness-config/services/harness-config-service.js";
import { createHarnessCatalog } from "../../modules/templates/domain/harness-catalog.js";

const { harnesses } = z
  .object({ harnesses: harnessCatalogConfigSchema })
  .parse(
    load(
      readFileSync(
        new URL("../../../../../helm/values.yaml", import.meta.url),
        "utf8",
      ),
    ),
  );
const catalog = createHarnessCatalog(harnesses, true);

const imageHarness: HarnessCapability = {
  name: "image-agent",
  harnessConfig: false,
  sessionModel: false,
  dialects: ["openai-chat"],
  title: "Image Agent",
};

/**
 * TEST_OVERVIEW: an image harness — one the agent's own image carries and the
 * install's catalog does not list — is offered for that agent from what its
 * runtime reports: its title names it and its dialects decide which providers
 * it fits. Nothing in the platform names such a harness.
 */
describe("image harnesses", () => {
  /**
   * TEST_SCENARIO: a Chat Completions harness fits every provider that serves
   * that dialect to any harness, and not one kept to a single harness (Bob's
   * gateway, an Anthropic subscription) or one that speaks another API.
   */
  it.each<[string, boolean]>([
    ["ibm-litellm", true],
    ["curve-bender", true],
    ["openai", true],
    ["anthropic", false],
    ["anthropic-oauth", false],
    ["bedrock", false],
    ["bob", false],
  ])("fits %s by its reported dialect: %s", (templateId, fits) => {
    const views = { harnesses: withImageHarnesses(catalog, [imageHarness]) };
    const type = providerTypeForTemplateId(templateId)!;
    expect(harnessFits(views, "image-agent", type, templateId)).toBe(fits);
  });

  /**
   * TEST_SCENARIO: the harness is shown under the title its ACP agent gives,
   * and under its own id when the manifest names no agent.
   */
  it("names the harness by its reported title, else its id", () => {
    const [titled] = withImageHarnesses({ harnesses: [] }, [imageHarness]);
    expect(titled?.displayName).toBe("Image Agent");
    const { title: _, ...untitled } = imageHarness;
    const [bare] = withImageHarnesses({ harnesses: [] }, [untitled]);
    expect(bare?.displayName).toBe("image-agent");
  });

  /**
   * TEST_SCENARIO: a catalog harness the agent also reports keeps its catalog
   * entry, and a reported harness that the Model Router does not serve — no
   * dialect, or none the platform knows — is not offered at all.
   */
  it("adds only routed harnesses the catalog does not list", () => {
    const views = withImageHarnesses(catalog, [
      { name: "codex", harnessConfig: true, sessionModel: true, dialects: ["openai-responses"] },
      { name: "unrouted", harnessConfig: false, sessionModel: false },
      { name: "future", harnessConfig: false, sessionModel: false, dialects: ["gemini"] },
      imageHarness,
    ]);
    expect(views.map((h) => h.name)).toEqual([
      ...catalog.harnesses.map((h) => h.name),
      "image-agent",
    ]);
    expect(views.filter((h) => h.name === "codex")).toEqual(
      catalog.harnesses.filter((h) => h.name === "codex"),
    );
  });

  /**
   * TEST_SCENARIO: an unattended turn on an agent whose own harness is an
   * image harness runs on its saved default, rather than being skipped as a
   * harness the platform does not offer.
   */
  it("resolves an unattended turn on the agent's image harness", async () => {
    const pair = await resolveFirePair(
      {
        catalog,
        pairRepo: {
          read: async () => ({
            harness: "image-agent",
            provider: "ibm",
            model: "ibm/gpt-5",
          }),
          grantedProviders: async () => [
            { id: "ibm", type: "ibm-litellm", templateId: "ibm-litellm" },
          ],
        },
        specHarness: async () => undefined,
        getCapabilities: async () => ({
          defaultHarness: "image-agent",
          modelRouter: true,
          harnesses: [imageHarness],
        }),
      },
      "agent-1",
      "scheduled",
      {},
    );
    expect(pair).toEqual({
      harness: "image-agent",
      provider: "ibm",
      model: "ibm/gpt-5",
    });
  });

  /**
   * TEST_SCENARIO: the same harness reported without dialects is a custom
   * image's unrouted harness, which keeps the old answer: no pair.
   */
  it("still skips an unrouted harness the catalog does not offer", async () => {
    const { dialects: _, ...unrouted } = imageHarness;
    const pair = await resolveFirePair(
      {
        catalog,
        pairRepo: {
          read: async () => null,
          grantedProviders: async () => [],
        },
        specHarness: async () => undefined,
        getCapabilities: async () => ({
          defaultHarness: "image-agent",
          harnesses: [unrouted],
        }),
      },
      "agent-1",
      "scheduled",
      {},
    );
    expect(pair).toBeUndefined();
  });
});
