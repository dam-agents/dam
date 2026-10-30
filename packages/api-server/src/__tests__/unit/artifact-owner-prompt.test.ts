/**
 * TEST_OVERVIEW: An owner's artifact prompt with no chat docked. A button on
 * an interactive page the owner opened in the library, outside a chat with
 * its publishing agent, may ask for a Session of its own. The server sends
 * it to the owner's own Session for that page on the publishing agent, one
 * per owner and artifact, found again on the next click, as a viewer's
 * prompt goes to theirs. The same pages are refused as for the Artifact API,
 * and while the owner has the feature off.
 */
import { describe, expect, it } from "vitest";

import {
  createArtifactApiWorld,
  type PublishOptions,
} from "../helpers/artifact-api-world.js";

describe("Artifact prompt — no chat docked", () => {
  /**
   * TEST_SCENARIO: The owner opens the dashboard from the library and clicks
   * a button that asks for a new Session. The prompt reaches the publishing
   * agent in the owner's own Session for this page, titled so the owner
   * finds it in the session list, and the agent is told where it came from.
   */
  it("should hand the prompt to the owner's own session on the publishing agent", async () => {
    const world = createArtifactApiWorld();
    const dashboard = world.publish({ by: "agent-a" });

    await expect(
      world.prompt(dashboard, "Refresh the numbers", {
        email: "alice@example.com",
      }),
    ).resolves.toEqual({ ok: true });

    const [sent, ...rest] = world.prompts();
    expect(rest).toEqual([]);
    expect(sent).toMatchObject({
      agentId: "agent-a",
      sessionKey: `artifact:${dashboard}:alice`,
      sessionTitle: "alice@example.com · Dashboard",
    });
    expect(sent!.prompt).toContain(`"Dashboard" (id ${dashboard})`);
    expect(sent!.prompt).toMatch(/\nMessage: Refresh the numbers$/);
  });

  /**
   * TEST_SCENARIO: The owner signs in with an unverified email. The Session
   * is titled by their subject instead, so an unverified address never
   * names it.
   */
  it("should title the session by the owner's subject without a verified email", async () => {
    const world = createArtifactApiWorld();
    const dashboard = world.publish({ by: "agent-a" });

    await world.prompt(dashboard, "Refresh");

    expect(world.prompts()[0]).toMatchObject({
      sessionTitle: "alice · Dashboard",
    });
  });

  /**
   * TEST_SCENARIO: The owner clicks again later. The second prompt carries
   * the same key, so it continues the Session the first one opened.
   */
  it("should continue the same session on a later click", async () => {
    const world = createArtifactApiWorld();
    const dashboard = world.publish({ by: "agent-a" });

    await world.prompt(dashboard, "One");
    await world.prompt(dashboard, "Two");

    const [first, second] = world.prompts();
    expect(second!.sessionKey).toBe(first!.sessionKey);
  });

  /**
   * TEST_SCENARIO: The agent is at its spend limit, or does not wake. The
   * page's owner is told why, rather than the prompt silently vanishing.
   */
  it.each(["spend-limit", "agent-unreachable"] as const)(
    "should report %s",
    async (outcome) => {
      const world = createArtifactApiWorld();
      world.answerPromptsWith(outcome);
      const dashboard = world.publish({ by: "agent-a" });

      await expect(world.prompt(dashboard, "Refresh")).resolves.toEqual({
        ok: false,
        reason: outcome,
      });
    },
  );
});

describe("Artifact prompt — who may not start a session", () => {
  /**
   * TEST_SCENARIO: Only the owner's interactive html page that an agent
   * published may start a Session, and never a public one. Nothing is
   * delivered for any other page.
   */
  it.each<[string, PublishOptions]>([
    ["shared by public link", { visibility: "public" }],
    ["not interactive", { interactive: false }],
    ["not an html page", { kind: "markdown" }],
    ["uploaded by the user", { by: null }],
    ["owned by someone else", { owner: "bob" }],
  ])("should refuse an artifact that is %s", async (_case, published) => {
    const world = createArtifactApiWorld();
    const artifact = world.publish(published);

    await expect(world.prompt(artifact, "Refresh")).resolves.toEqual({
      ok: false,
      reason: "not-allowed",
    });
    expect(world.prompts()).toEqual([]);
  });

  it("should refuse an API key bound to a different agent", async () => {
    const world = createArtifactApiWorld();
    const dashboard = world.publish({ by: "agent-a" });

    await expect(
      world.prompt(dashboard, "Refresh", { keyBoundTo: ["agent-b"] }),
    ).resolves.toEqual({ ok: false, reason: "not-allowed" });
    expect(world.prompts()).toEqual([]);
  });

  /**
   * TEST_SCENARIO: The owner turned interactive artifacts off. The page's
   * buttons stop reaching the agent at once, as they do in chat.
   */
  it("should refuse while the owner has the feature off", async () => {
    const world = createArtifactApiWorld();
    world.turnFeatureOff();
    const dashboard = world.publish({ by: "agent-a" });

    await expect(world.prompt(dashboard, "Refresh")).resolves.toEqual({
      ok: false,
      reason: "not-allowed",
    });
    expect(world.prompts()).toEqual([]);
  });
});
