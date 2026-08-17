import { describe, it, expect } from "vitest";
import { isTermsOnlyTrpcCall } from "../../apps/api-server/admission/terms-middleware.js";

// TEST_OVERVIEW: The HTTP terms gate decides which tRPC calls may run before a user has accepted the terms. It must exempt exactly the pre-acceptance terms procedures and gate everything else, matching tRPC's own path parsing so a batch cannot smuggle a gated procedure past it.

describe("isTermsOnlyTrpcCall", () => {
  it("exempts each pre-acceptance terms procedure", () => {
    expect(isTermsOnlyTrpcCall("/api/trpc/terms.current")).toBe(true);
    expect(isTermsOnlyTrpcCall("/api/trpc/terms.latestAcceptance")).toBe(true);
    expect(isTermsOnlyTrpcCall("/api/trpc/terms.accept")).toBe(true);
  });

  it("exempts a batch composed only of pre-acceptance terms procedures", () => {
    expect(isTermsOnlyTrpcCall("/api/trpc/terms.current,terms.accept")).toBe(
      true,
    );
  });

  it("gates a batch that mixes a gated procedure after a terms one", () => {
    expect(
      isTermsOnlyTrpcCall("/api/trpc/terms.latestAcceptance,agents.list"),
    ).toBe(false);
  });

  // TEST_SCENARIO: The bypass this gate exists to close — tRPC decodes the path with decodeURIComponent before splitting on the batch comma, so an encoded comma (%2C) that looks like a single terms procedure here would fan out into a two-call batch inside tRPC. The gate must decode the same way and gate it.
  it("gates an encoded-comma batch that hides a gated procedure", () => {
    expect(
      isTermsOnlyTrpcCall("/api/trpc/terms.latestAcceptance%2Cagents.list"),
    ).toBe(false);
  });

  it("gates a non-exempt terms procedure that only shares the prefix", () => {
    expect(isTermsOnlyTrpcCall("/api/trpc/terms.deleteEverything")).toBe(false);
    expect(isTermsOnlyTrpcCall("/api/trpc/termsX.list")).toBe(false);
  });

  it("gates ordinary procedures and non-trpc paths", () => {
    expect(isTermsOnlyTrpcCall("/api/trpc/agents.list")).toBe(false);
    expect(isTermsOnlyTrpcCall("/api/health")).toBe(false);
    expect(isTermsOnlyTrpcCall("/api/trpc/")).toBe(false);
  });

  it("fails closed on a malformed percent-encoding", () => {
    expect(isTermsOnlyTrpcCall("/api/trpc/terms.accept%ZZ")).toBe(false);
  });
});
