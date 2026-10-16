/**
 * TEST_OVERVIEW: A qualified model name is `<alias>/<upstream id>`; the alias
 * is one of the fixed provider aliases and the upstream id may itself contain
 * slashes. Claude Code sees every name under a `claude/` prefix. A name whose
 * first segment is no alias is a bare name and parses to null.
 */
import { describe, expect, it } from "vitest";
import {
  formatQualifiedModel,
  isQualifiedModel,
  parseQualifiedModel,
  PROVIDER_ALIASES,
  aliasForTemplateId,
  templateIdsForAlias,
} from "api-server-api";

describe("qualified model names", () => {
  /** TEST_SCENARIO: The upstream id keeps every slash after the alias, so a
   * Curve Bender model under a deployment prefix round-trips. */
  it("splits at the first slash only", () => {
    expect(parseQualifiedModel("cb/rits/zai-org/glm-5-3")).toEqual({
      alias: "cb",
      upstreamId: "rits/zai-org/glm-5-3",
    });
    expect(formatQualifiedModel("cb", "rits/zai-org/glm-5-3")).toBe(
      "cb/rits/zai-org/glm-5-3",
    );
  });

  /** TEST_SCENARIO: Claude Code's discovery filter needs `claude` in every id,
   * so its names carry a `claude/` prefix that only a caller asking for it
   * strips; without the option the prefix is no alias and the name is bare. */
  it("strips the claude prefix on request", () => {
    expect(
      parseQualifiedModel("claude/ibm/aws/claude-opus-4-8", {
        claudePrefix: true,
      }),
    ).toEqual({ alias: "ibm", upstreamId: "aws/claude-opus-4-8" });
    expect(parseQualifiedModel("claude/ibm/aws/claude-opus-4-8")).toBeNull();
  });

  /** TEST_SCENARIO: A harness's own picker entry, a tier alias or an unknown
   * prefix is a bare name, as is a name with nothing after the alias. */
  it("treats names without a known alias as bare", () => {
    expect(parseQualifiedModel("gpt-5.5")).toBeNull();
    expect(parseQualifiedModel("premium-ide")).toBeNull();
    expect(parseQualifiedModel("acme/gpt-5.5")).toBeNull();
    expect(parseQualifiedModel("ibm/")).toBeNull();
    expect(parseQualifiedModel("/gpt-5.5")).toBeNull();
    expect(parseQualifiedModel(null)).toBeNull();
    expect(isQualifiedModel("ibm/gpt-5.5")).toBe(true);
    expect(isQualifiedModel("gpt-5.5")).toBe(false);
  });
});

describe("provider aliases", () => {
  /** TEST_SCENARIO: The alias is fixed per preset and shared by every user;
   * both Anthropic templates share one alias, and the catalog order starts
   * with IBM so the creation default stays IBM-first. */
  it("maps every template to its alias and back", () => {
    expect(PROVIDER_ALIASES[0]).toBe("ibm");
    expect(aliasForTemplateId("ibm-litellm")).toBe("ibm");
    expect(aliasForTemplateId("curve-bender")).toBe("cb");
    expect(aliasForTemplateId("anthropic")).toBe("anthropic");
    expect(aliasForTemplateId("anthropic-oauth")).toBe("anthropic");
    expect(aliasForTemplateId("slack")).toBeNull();
    expect(templateIdsForAlias("anthropic").sort()).toEqual([
      "anthropic",
      "anthropic-oauth",
    ]);
  });
});
