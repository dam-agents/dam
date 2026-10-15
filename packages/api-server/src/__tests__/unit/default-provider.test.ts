/**
 * TEST_OVERVIEW: One function answers which provider is an Agent's default for
 * a harness. The pair saved on the Providers page wins for its own harness
 * while its provider is granted and accepted; otherwise the first accepted
 * provider in the alias catalog order (ibm, cb, anthropic, openai, bedrock,
 * bob), whatever order the grants were read in.
 */
import { describe, expect, it } from "vitest";
import {
  orderByAlias,
  resolveDefaultProvider,
  type ProviderChoice,
} from "api-server-api";

const oai: ProviderChoice = { id: "oai", type: "openai" };
const cb: ProviderChoice = { id: "cb", type: "curve-bender" };
const ibm: ProviderChoice = { id: "ibm", type: "ibm-litellm" };
const claude: ProviderChoice = { id: "claude", type: "anthropic" };

describe("resolveDefaultProvider", () => {
  /** TEST_SCENARIO: Grants read by connection name (oai, cb, ibm) default
   * by the alias order, not the read order, except that a harness's own
   * provider comes first: Codex runs on OpenAI when the agent holds it, a
   * harness with no home provider (Pi) on IBM. */
  it("picks the harness's own provider, then the alias order", () => {
    expect(orderByAlias([oai, cb, ibm]).map((p) => p.id)).toEqual([
      "ibm",
      "cb",
      "oai",
    ]);
    expect(orderByAlias([oai, cb, ibm], "codex").map((p) => p.id)).toEqual([
      "oai",
      "ibm",
      "cb",
    ]);
    expect(
      resolveDefaultProvider({
        harness: "codex",
        saved: null,
        granted: [oai, cb, ibm],
        accepts: () => true,
      }),
    ).toBe(oai);
    expect(
      resolveDefaultProvider({
        harness: "pi",
        saved: null,
        granted: [oai, cb, ibm],
        accepts: () => true,
      }),
    ).toBe(ibm);
    expect(
      resolveDefaultProvider({
        harness: "codex",
        saved: null,
        granted: [oai, cb, ibm],
        accepts: (p) => p.type !== "openai",
      }),
    ).toBe(ibm);
  });

  /** TEST_SCENARIO: The saved pair was picked for this harness and its
   * provider is still granted, so it beats the alias order. A pair saved for
   * Claude Code says nothing about Codex, a saved provider since revoked is
   * gone, and one the harness no longer accepts is skipped; each falls back
   * to the first fit, Codex's own OpenAI ahead of the alias order. */
  it("prefers the saved pair for its own harness while its provider holds", () => {
    const granted = [ibm, oai];
    expect(
      resolveDefaultProvider({
        harness: "codex",
        saved: { harness: "codex", provider: "ibm" },
        granted,
        accepts: () => true,
      }),
    ).toBe(ibm);
    expect(
      resolveDefaultProvider({
        harness: "codex",
        saved: { harness: "claude-code", provider: "ibm" },
        granted,
        accepts: () => true,
      }),
    ).toBe(oai);
    expect(
      resolveDefaultProvider({
        harness: "codex",
        saved: { harness: "codex", provider: "gone" },
        granted,
        accepts: () => true,
      }),
    ).toBe(oai);
    expect(
      resolveDefaultProvider({
        harness: "codex",
        saved: { harness: "codex", provider: "oai" },
        granted,
        accepts: (p) => p.type !== "openai",
      }),
    ).toBe(ibm);
  });

  /** TEST_SCENARIO: No granted provider fits the harness, so there is no
   * default and the caller reports that instead of guessing. */
  it("returns null when nothing fits", () => {
    expect(
      resolveDefaultProvider({
        harness: "codex",
        saved: { harness: "codex", provider: "claude" },
        granted: [claude],
        accepts: () => false,
      }),
    ).toBeNull();
  });
});
