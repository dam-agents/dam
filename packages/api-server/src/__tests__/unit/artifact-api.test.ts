/**
 * TEST_OVERVIEW: Artifact API, the api-server hop. A private interactive
 * artifact that an agent published can ask that agent for data. The owner's
 * session calls artifactLibrary.callAgentApi with the artifact id; the server
 * reads the agent from the artifact, wakes it, and relays the request to the
 * app the agent serves on the Artifact API Port. Share links, other people's
 * artifacts and user uploads are refused with "not-allowed" before any agent
 * is woken.
 */
import { describe, expect, it } from "vitest";

import {
  createArtifactApiWorld,
  type PublishOptions,
} from "../helpers/artifact-api-world.js";

const ping = { method: "GET", path: "/ping" } as const;
const pong = {
  status: 200,
  contentType: "application/json",
  body: '{"pong":1}',
};

describe("Artifact API — asking the publishing agent", () => {
  /**
   * TEST_SCENARIO: The owner opens a dashboard their agent published and the
   * page asks for fresh numbers. The agent's app answers, and the page gets
   * that answer as it is. This is what turns an interactive artifact into a
   * small personal app.
   */
  it("should return the agent app's answer to the owner", async () => {
    const world = createArtifactApiWorld();
    world.agent("agent-a").serve(() => pong);
    const dashboard = world.publish({ by: "agent-a" });

    await expect(world.call(dashboard, ping)).resolves.toEqual({
      ok: true,
      ...pong,
    });
  });

  /**
   * TEST_SCENARIO: The app answers 404. The page still gets the status and
   * body, like fetch does. Only platform failures are errors, so the page
   * author can handle their own app's errors.
   */
  it("should pass a non-2xx answer through as an answer", async () => {
    const world = createArtifactApiWorld();
    world
      .agent("agent-a")
      .serve(() => ({ status: 404, contentType: "text/plain", body: "nope" }));
    const dashboard = world.publish({ by: "agent-a" });

    await expect(world.call(dashboard, ping)).resolves.toEqual({
      ok: true,
      status: 404,
      contentType: "text/plain",
      body: "nope",
    });
  });

  /**
   * TEST_SCENARIO: The agent hibernated while the owner was away. Opening the
   * dashboard wakes it, and the request reaches the app. Without the wake, a
   * page would fail every time its agent had been idle.
   */
  it("should wake a hibernated agent before relaying", async () => {
    const world = createArtifactApiWorld();
    const agent = world
      .agent("agent-a")
      .hibernate()
      .serve(() => pong);
    const dashboard = world.publish({ by: "agent-a" });

    await expect(world.call(dashboard, ping)).resolves.toMatchObject({
      ok: true,
    });
    expect(agent.isAwake()).toBe(true);
  });

  /**
   * TEST_SCENARIO: The owner has two agents that both serve an app. A page
   * published by one of them only ever reaches that one. The server picks the
   * agent from the artifact, so a page cannot talk to any other agent, even
   * one the same user owns.
   */
  it("should reach only the agent that published the artifact", async () => {
    const world = createArtifactApiWorld();
    const publisher = world.agent("agent-a").serve(() => pong);
    const other = world.agent("agent-b").serve(() => pong);
    const dashboard = world.publish({ by: "agent-a" });

    await world.call(dashboard, ping);

    expect(publisher.received()).toEqual(["GET /ping"]);
    expect(other.received()).toEqual([]);
  });
});

describe("Artifact API — who may not call", () => {
  /**
   * TEST_SCENARIO: Only a private, interactive html artifact that an agent
   * published may call, and only by its owner. Share links (restricted or
   * public) would let other people drive the owner's agent. User uploads
   * have no agent to call. In every case the agent stays asleep and its app
   * sees nothing.
   */
  it.each<[string, PublishOptions]>([
    ["shared by public link", { visibility: "public" }],
    ["shared with named viewers", { visibility: "restricted" }],
    ["not interactive", { interactive: false }],
    ["not an html page", { kind: "markdown" }],
    ["uploaded by the user", { by: null }],
    ["owned by someone else", { owner: "bob" }],
  ])("should refuse an artifact that is %s", async (_case, published) => {
    const world = createArtifactApiWorld();
    const agent = world
      .agent("agent-a")
      .hibernate()
      .serve(() => pong);
    const artifact = world.publish(published);

    await expect(world.call(artifact, ping)).resolves.toEqual({
      ok: false,
      reason: "not-allowed",
    });
    expect(agent.isAwake()).toBe(false);
    expect(agent.received()).toEqual([]);
  });

  /**
   * TEST_SCENARIO: An API key bound to one agent is used on an artifact that
   * another agent published. It is refused, so a bound key cannot reach an
   * agent through an artifact that it could not reach directly.
   */
  it("should refuse an API key bound to a different agent", async () => {
    const world = createArtifactApiWorld();
    const agent = world.agent("agent-a").serve(() => pong);
    const dashboard = world.publish({ by: "agent-a" });

    await expect(
      world.call(dashboard, ping, { keyBoundTo: ["agent-b"] }),
    ).resolves.toEqual({ ok: false, reason: "not-allowed" });
    expect(agent.received()).toEqual([]);
  });
});

describe("Artifact API — when the agent cannot answer", () => {
  /**
   * TEST_SCENARIO: The agent does not come up. The page gets
   * "agent-unreachable", so it can tell the owner the agent is down rather
   * than showing a blank result.
   */
  it("should answer agent-unreachable when the agent does not wake", async () => {
    const world = createArtifactApiWorld();
    world
      .agent("agent-a")
      .failToWake()
      .serve(() => pong);
    const dashboard = world.publish({ by: "agent-a" });

    await expect(world.call(dashboard, ping)).resolves.toEqual({
      ok: false,
      reason: "agent-unreachable",
    });
  });

  /**
   * TEST_SCENARIO: The agent's image carries a runtime that is older than
   * this feature. The page gets "unsupported-runtime", so the owner knows to
   * update the agent instead of debugging their app.
   */
  it("should answer unsupported-runtime for an old runtime", async () => {
    const world = createArtifactApiWorld();
    world.agent("agent-a").runOldRuntime();
    const dashboard = world.publish({ by: "agent-a" });

    await expect(world.call(dashboard, ping)).resolves.toEqual({
      ok: false,
      reason: "unsupported-runtime",
    });
  });

  /**
   * TEST_SCENARIO: The agent is up but nothing listens on the Artifact API
   * Port, for example after hibernation stopped the agent's server. The page
   * gets "app-not-listening" and can retry once the agent starts its app.
   */
  it("should answer app-not-listening when the agent serves no app", async () => {
    const world = createArtifactApiWorld();
    world.agent("agent-a");
    const dashboard = world.publish({ by: "agent-a" });

    await expect(world.call(dashboard, ping)).resolves.toEqual({
      ok: false,
      reason: "app-not-listening",
    });
  });
});
