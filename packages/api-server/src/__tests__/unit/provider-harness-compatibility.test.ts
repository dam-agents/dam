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
    ["ibm-litellm", ["claude-code", "codex", "pi", "bob"]],
    ["curve-bender", ["claude-code", "codex", "pi", "bob"]],
    ["anthropic", ["claude-code", "pi"]],
    ["anthropic-oauth", ["claude-code"]],
    ["openai", ["codex", "pi"]],
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
          write: async () => {},
          grantedProviders: async () => [
            { id: "oauth", type: "anthropic", templateId: "anthropic-oauth" },
          ],
        },
        getCapabilities: async () => ({
          defaultHarness: "pi",
          harnesses: [
            { name: "pi", harnessConfig: true, sessionModel: true },
            { name: "claude-code", harnessConfig: true, sessionModel: true },
          ],
        }),
      },
      "agent-1",
      {},
    );
    expect(pair).toEqual({
      harness: "claude-code",
      provider: "oauth",
      model: null,
    });
  });
});
