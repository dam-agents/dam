import { describe, it, expect } from "vitest";
import { createSessionMetadata, createWorld, frames } from "./acp-world.js";

/**
 * TEST_OVERVIEW: loading a Session id the runtime holds no metadata for.
 *
 * A session/load names the Session's platform MCP server by a ref, and the
 * runtime keeps that ref in the session metadata store so a tool call can
 * find its Session. The store is also what the session list shows, so the
 * ref is saved only once the harness has loaded the Session: an id the
 * harness does not know, from a mistyped or stale link, must leave nothing
 * behind in the list.
 */

const UNKNOWN = "00000000-0000-0000-0000-000000000000";
const HARNESS_ONLY = "sess-harness-only";

function setup() {
  const metadata = createSessionMetadata().store;
  const refs: string[] = [];
  const world = createWorld({
    sessionMetadata: metadata,
    sessionMcpServers: (ref) => {
      refs.push(ref);
      return [];
    },
  });
  return { world, metadata, refs };
}

describe("acp-runtime: loading a Session the runtime has no metadata for", () => {
  /**
   * TEST_SCENARIO: A link to a Session id that never existed is opened. The
   * harness refuses the load, and the id must not become a listed Session
   * with no title.
   */
  it("should save nothing for an id the harness refuses to load", () => {
    const { world, metadata } = setup();
    const bob = world.connect();

    bob.send(frames.loadSession(1, UNKNOWN));
    world.harness().refuseTo("session/load", {
      code: -32002,
      message: "Resource not found",
    });

    expect(bob.reply(1)).toMatchObject({ error: { code: -32002 } });
    expect(metadata.get(UNKNOWN)).toBeUndefined();
    expect(metadata.all()).toEqual({});
  });

  /**
   * TEST_SCENARIO: A Session the harness holds but the runtime has no
   * metadata for, as one made before the runtime kept metadata, loads. Its
   * ref is saved once the load succeeds, so a tool call through its platform
   * MCP server finds the Session.
   */
  it("should save the ref it sent once the harness loads the Session", () => {
    const { world, metadata, refs } = setup();
    const bob = world.connect();

    bob.send(frames.loadSession(1, HARNESS_ONLY));
    expect(metadata.get(HARNESS_ONLY)).toBeUndefined();
    world.harness().replyToSession("session/load", HARNESS_ONLY, {
      sessionId: HARNESS_ONLY,
    });

    expect(refs).toHaveLength(1);
    expect(metadata.get(HARNESS_ONLY)?.meta.ref).toBe(refs[0]);
    expect(metadata.findByRef(refs[0]!)).toBe(HARNESS_ONLY);
  });

  /**
   * TEST_SCENARIO: A refused load is tried again and then succeeds. The
   * second load sends a ref of its own, and that is the ref saved.
   */
  it("should save the ref of the load that succeeded after a refused one", () => {
    const { world, metadata, refs } = setup();
    const bob = world.connect();

    bob.send(frames.loadSession(1, HARNESS_ONLY));
    world.harness().refuseTo("session/load", {
      code: -32603,
      message: "Internal error",
    });
    bob.send(frames.loadSession(2, HARNESS_ONLY));
    const loads = world.harness().received("session/load");
    world.harness().emit({
      jsonrpc: "2.0",
      id: loads[loads.length - 1]!.id,
      result: { sessionId: HARNESS_ONLY },
    });

    expect(refs).toHaveLength(2);
    expect(metadata.get(HARNESS_ONLY)?.meta.ref).toBe(refs[1]);
  });
});
