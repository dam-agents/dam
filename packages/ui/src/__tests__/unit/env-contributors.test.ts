// TEST_OVERVIEW: The Services panel files an inherited variable under whoever contributes it — the platform, a provider or one connection — and its search matches a variable's name or its value in any case, so a group is never empty without the reader asking for that.
import { expect, it } from "vitest";

import {
  contributorOf,
  matchesEnvQuery,
} from "../../modules/agents/lib/env-contributors.js";

// TEST_SCENARIO: each kind of contributor names its group, and two contributions from the same source share one.
it("names a variable's contributor", () => {
  expect(contributorOf("system")).toEqual({
    key: "platform",
    title: "From the platform",
  });
  const anthropic = { kind: "provider" as const, label: "Anthropic" };
  expect(contributorOf(anthropic)).toEqual({
    key: "provider:Anthropic",
    title: "From the provider Anthropic",
  });
  const header = { kind: "connection" as const, label: "custom-headers" };
  expect(contributorOf(header).key).toBe("connection:custom-headers");
  expect(contributorOf(header).title).toBe(
    "From the connection custom-headers",
  );
});

// TEST_SCENARIO: the search reads the name and the value, in any case, and an empty one keeps everything.
it("matches a variable's name or value", () => {
  const entry = { name: "OPENAI_BASE_URL", value: "https://api.example.com" };
  expect(matchesEnvQuery("", entry)).toBe(true);
  expect(matchesEnvQuery("  ", entry)).toBe(true);
  expect(matchesEnvQuery("openai", entry)).toBe(true);
  expect(matchesEnvQuery("EXAMPLE", entry)).toBe(true);
  expect(matchesEnvQuery("anthropic", entry)).toBe(false);
});
