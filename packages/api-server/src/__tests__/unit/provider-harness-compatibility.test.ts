import { readFileSync } from "node:fs";
import {
  harnessCatalogConfigSchema,
  harnessFits,
  providerTypeForTemplateId,
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

describe("provider harness compatibility", () => {
  it.each<[string, string[]]>([
    ["ibm-litellm", ["claude-code", "codex", "pi", "bob", "copilot"]],
    ["curve-bender", ["claude-code", "codex", "pi", "bob", "copilot"]],
    ["anthropic", ["claude-code", "pi"]],
    ["anthropic-oauth", ["claude-code"]],
    ["openai", ["codex", "pi", "copilot"]],
    ["bedrock", ["claude-code", "pi"]],
    ["bob", ["bob"]],
  ])(
    "fits %s against the shipped harness assignments",
    (templateId, expected) => {
      const type = providerTypeForTemplateId(templateId);
      expect(type).not.toBeNull();
      expect(
        catalog.harnesses
          .filter((h) => type && harnessFits(catalog, h.name, type, templateId))
          .map((h) => h.name),
      ).toEqual(expected);
    },
  );

  // TEST_SCENARIO: a values file that still lists a provider the api-server no longer offers keeps the install starting: the id is dropped from the harness's list instead of failing the chart's parse, which would crash-loop the api-server.
  it("drops a provider the api-server no longer offers", () => {
    const parsed = harnessCatalogConfigSchema.parse({
      default: "claude-code",
      catalog: {
        "claude-code": {
          displayName: "Claude",
          providers: ["ibm-litellm", "platform"],
        },
      },
    });
    expect(parsed.catalog["claude-code"]?.providers).toEqual(["ibm-litellm"]);
  });

  it("moves an automatic turn off a remembered Pi/OAuth pair", async () => {
    const pair = await resolveFirePair(
      {
        catalog,
        pairRepo: {
          read: async () => ({
            harness: "pi",
            provider: "oauth",
            model: "old",
          }),
          grantedProviders: async () => [
            { id: "oauth", type: "anthropic", templateId: "anthropic-oauth" },
          ],
        },
        specHarness: async () => undefined,
        getCapabilities: async () => ({
          defaultHarness: "pi",
          harnesses: [
            {
              name: "pi",
              harnessConfig: true,
              sessionModel: true,
              sessionSettings: ["mode"],
            },
            {
              name: "claude-code",
              harnessConfig: true,
              sessionModel: true,
              sessionSettings: ["mode"],
            },
          ],
        }),
      },
      "agent-1",
      "channel",
      {},
    );
    expect(pair).toEqual({
      harness: "claude-code",
      provider: "oauth",
      model: null,
    });
  });
});
