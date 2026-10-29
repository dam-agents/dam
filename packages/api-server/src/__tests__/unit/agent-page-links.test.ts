// TEST_OVERVIEW: A link the api-server writes into a reply opens a section of the agent's page that the UI routes, never Not found: the server builds it from the same section list the UI's routes use, and no source spells a section by hand.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { SANDBOX_SECTIONS } from "api-server-api";
import { describe, expect, it } from "vitest";
import { AcpModelRefusedError } from "../../core/acp-client.js";
import { ChannelProfileRefusedError } from "../../modules/channels/infrastructure/channel-profile.js";
import { classifyTurnFailure } from "../../modules/channels/infrastructure/turn-failure-copy.js";

const SRC = join(import.meta.dirname, "../..");

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "__tests__") return [];
    return statSync(path).isDirectory()
      ? sources(path)
      : path.endsWith(".ts")
        ? [path]
        : [];
  });

describe("links to an agent's page", () => {
  /** TEST_SCENARIO: a section written by hand into a link, such as one a page regrouping removed, is caught here rather than by a user who meets Not found. */
  it("names only sections the UI routes", () => {
    const unknown = sources(SRC).flatMap((path) =>
      [
        ...readFileSync(path, "utf8").matchAll(
          /\/sandboxes\/\$\{[^}]+\}\/([a-z-]+)/g,
        ),
      ]
        .map((m) => m[1]!)
        .filter(
          (section) =>
            !(SANDBOX_SECTIONS as readonly string[]).includes(section),
        )
        .map((section) => `${path}: ${section}`),
    );
    expect(unknown).toEqual([]);
  });

  /** TEST_SCENARIO: a channel whose profile cannot run sends its owner to the agent's Channels section, where the channel's row picks another profile. */
  it("sends a refused channel profile to the Channels section", () => {
    const failure = classifyTurnFailure(
      new ChannelProfileRefusedError("Fast review", "no provider"),
    );
    expect(failure.kind).toBe("plain");
    if (failure.kind !== "plain") return;
    expect(
      failure.copy({
        uiBaseUrl: "https://dam.example",
        agentId: "agent-1",
        threads: true,
      }),
    ).toContain("https://dam.example/sandboxes/agent-1/channels");
  });

  /** TEST_SCENARIO: a message the model refused sends the owner to the agent's Providers section, where another model can be picked. */
  it("sends a model refusal to the Providers section", () => {
    const failure = classifyTurnFailure(new AcpModelRefusedError("s-1"));
    expect(failure.kind).toBe("plain");
    if (failure.kind !== "plain") return;
    expect(
      failure.copy({
        uiBaseUrl: "https://dam.example",
        agentId: "agent-1",
        threads: true,
      }),
    ).toContain("https://dam.example/sandboxes/agent-1/providers");
  });
});
