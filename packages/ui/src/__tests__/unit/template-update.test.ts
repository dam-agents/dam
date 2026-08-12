import { describe, expect, test } from "vitest";

import { whatsNewUrl } from "../../modules/agents/utils/template-update.js";

const CLAUDE = "https://code.claude.com/docs/en/whats-new";

describe("whatsNewUrl", () => {
  test("resolves the shipped template images", () => {
    expect(whatsNewUrl("quay.io/dam-agents/claude-code:1.0.21")).toBe(CLAUDE);
    expect(whatsNewUrl("quay.io/dam-agents/codex:2.3.0")).toBe(
      "https://github.com/openai/codex/releases",
    );
    expect(whatsNewUrl("quay.io/dam-agents/bob:0.9.0")).toBe(
      "https://bob.ibm.com/docs/shell/changelog",
    );
  });

  test("treats a harness's variants as the same product", () => {
    expect(whatsNewUrl("quay.io/dam-agents/claude-code-vm:1.0.21")).toBe(
      CLAUDE,
    );
    // What a local `cluster:build-agent` produces.
    expect(whatsNewUrl("platform-claude-code:latest")).toBe(CLAUDE);
  });

  test("reads the name through a registry port and a digest", () => {
    expect(whatsNewUrl("localhost:30500/private/claude-code:test")).toBe(
      CLAUDE,
    );
    expect(whatsNewUrl("quay.io/dam-agents/claude-code@sha256:abc123")).toBe(
      CLAUDE,
    );
  });

  test("matches on the name only, never the registry", () => {
    expect(whatsNewUrl("codex.example.com/acme/pi-agent:1.0")).toBeNull();
    expect(whatsNewUrl("registry.bob.io/acme/k-search:1.0")).toBeNull();
  });

  test("is null for a harness that publishes nothing we know of", () => {
    expect(whatsNewUrl("quay.io/dam-agents/pi-agent:1.0")).toBeNull();
    expect(whatsNewUrl("quay.io/dam-agents/k-search:1.0")).toBeNull();
  });
});
