/**
 * TEST_OVERVIEW: Where Claude Code's auto-mode classifier call runs when its
 * session is on another provider: the session provider's preferred
 * classifier, else the session's own model. A call that is not the process's
 * classifier is left alone, and so is one whose session runs server-side auto
 * mode, where the provider itself answers the check.
 */
import { describe, expect, it } from "vitest";
import type { ProviderAlias } from "api-server-api";
import type {
  CatalogEntry,
  CatalogProvider,
} from "../../modules/model-catalog/index.js";
import { classifierModelOnSessionProvider } from "../../modules/model-router/index.js";
import type { ModelRouterBinding } from "../../modules/runtime-channel/manifest.js";

const binding: ModelRouterBinding = {
  dialects: ["anthropic-messages"],
  namePrefix: "claude/",
  lowercaseNames: true,
  claudeTiers: true,
  classifierModelEnv: "CLAUDE_CODE_AUTO_MODE_MODEL",
};

const PROCESS_CLASSIFIER = "claude/anthropic/claude-sonnet-5-5";
const CB_WORK = "rits/deepseek-ai/DeepSeek-V4.1-Flash-1017";
const CB_CLASSIFIER = "rits/nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-NVFP4";

const entry = (alias: ProviderAlias, upstreamId: string) =>
  ({
    name: `${alias}/${upstreamId}`,
    alias,
    connectionId: `conn-${alias}`,
    template: alias === "cb" ? "curve-bender" : alias,
    upstreamId,
    dialects: ["anthropic-messages"],
    metadata: {
      contextWindow: 200_000,
      maxOutputTokens: null,
      reasoning: null,
      vision: null,
      cacheControl: null,
      thinkingFormat: null,
      prices: null,
      source: { limits: "none", prices: "none" },
    },
  }) as CatalogEntry;

const provider = (alias: ProviderAlias, ids: string[]): CatalogProvider => ({
  connectionId: `conn-${alias}`,
  alias,
  template: alias === "cb" ? "curve-bender" : alias,
  displayName: alias,
  dialects: ["anthropic-messages"],
  status: "listed",
  listedAt: null,
  entries: ids.map((id) => entry(alias, id)),
});

const where = (input: {
  requested?: string;
  sessionModel: string;
  providers: readonly CatalogProvider[];
  processClassifier?: string | null;
}) =>
  classifierModelOnSessionProvider({
    requested: input.requested ?? PROCESS_CLASSIFIER,
    sessionModel: input.sessionModel,
    harness: "claude-code",
    binding,
    providers: input.providers,
    processClassifier:
      input.processClassifier === undefined
        ? PROCESS_CLASSIFIER
        : input.processClassifier,
  });

describe("the classifier's own call", () => {
  /** TEST_SCENARIO: A CurveBender session sends the Anthropic Sonnet the process holds; CurveBender lists the platform's preferred classifier, so the call runs on that Nemotron rather than on the model the session left behind. */
  it("lands on the session provider's preferred classifier", () => {
    expect(
      where({
        sessionModel: `cb/${CB_WORK}`,
        providers: [provider("cb", [CB_WORK, CB_CLASSIFIER])],
      }),
    ).toBe(`claude/cb/${CB_CLASSIFIER.toLowerCase()}`);
  });

  /** TEST_SCENARIO: A session provider that lists none of the list's classifier models has no classifier of its own, so the call falls back to the session's own model, rendered as the router resolves it. */
  it("falls back to the session's own model", () => {
    expect(
      where({
        sessionModel: `cb/${CB_WORK}`,
        providers: [provider("cb", [CB_WORK, "rits/zai-org/glm-5-4"])],
      }),
    ).toBe(`claude/cb/${CB_WORK.toLowerCase()}`);
  });

  /** TEST_SCENARIO: A session provider with no listing at all still answers with the session's own model rather than the provider it left. */
  it("falls back to the session's own model without a listing", () => {
    expect(where({ sessionModel: `cb/${CB_WORK}`, providers: [] })).toBe(
      `claude/cb/${CB_WORK.toLowerCase()}`,
    );
  });

  /** TEST_SCENARIO: Anthropic and the IBM proxy answer the auto-mode check themselves, so a Claude session there passes the call through unchanged; IBM with a GPT session does not, so it gets IBM's preferred classifier. */
  it("passes a server-side auto-mode session through, and moves a GPT one", () => {
    const ibm = provider("ibm", [
      "aws/claude-opus-5-5",
      "aws/claude-sonnet-5-5",
      "gpt-5.5",
    ]);
    expect(
      where({ sessionModel: "anthropic/claude-opus-5-5", providers: [ibm] }),
    ).toBeNull();
    expect(
      where({ sessionModel: "ibm/aws/claude-opus-5-5", providers: [ibm] }),
    ).toBeNull();
    expect(where({ sessionModel: "ibm/gpt-5.5", providers: [ibm] })).toBe(
      "claude/ibm/aws/claude-sonnet-5-5",
    );
  });

  /** TEST_SCENARIO: Only the exact name the process's classifier variable holds is the classifier's call; another call stays where the harness sent it, and so does one when no provider named a classifier at all. */
  it("leaves every other call alone", () => {
    const providers = [provider("cb", [CB_WORK, CB_CLASSIFIER])];
    expect(
      where({
        requested: "claude/anthropic/claude-haiku-5-5",
        sessionModel: `cb/${CB_WORK}`,
        providers,
      }),
    ).toBeNull();
    expect(
      where({
        sessionModel: `cb/${CB_WORK}`,
        providers,
        processClassifier: null,
      }),
    ).toBeNull();
  });
});
