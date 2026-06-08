import { describe, it, expect } from "vitest";
import { createSessionPresence } from "../../apps/api-server/session-presence.js";
import { ACTIVE_SESSION_KEY } from "../../modules/agents/infrastructure/labels.js";

function fakeRepo() {
  const patches: { id: string; value: string }[] = [];
  return {
    patches,
    repo: {
      async patchAnnotation(id: string, key: string, value: string) {
        if (key === ACTIVE_SESSION_KEY) patches.push({ id, value });
      },
    },
  };
}

describe("createSessionPresence", () => {
  it("sets the pin on 0->1 and clears it on 1->0", async () => {
    const { repo, patches } = fakeRepo();
    const presence = createSessionPresence(repo);

    const release = presence.acquire("agent-1");
    await Promise.resolve();
    expect(patches).toEqual([{ id: "agent-1", value: "true" }]);

    release();
    await Promise.resolve();
    expect(patches).toEqual([
      { id: "agent-1", value: "true" },
      { id: "agent-1", value: "" },
    ]);
  });

  it("keeps the pin while any connection is open — no flicker across relays", async () => {
    const { repo, patches } = fakeRepo();
    const presence = createSessionPresence(repo);

    // e.g. an SSH connection and a terminal connection to the same agent.
    const releaseSsh = presence.acquire("agent-1");
    const releaseTerm = presence.acquire("agent-1");
    await Promise.resolve();

    // Closing the terminal must NOT clear the pin while SSH is still open.
    releaseTerm();
    await Promise.resolve();
    expect(patches).toEqual([{ id: "agent-1", value: "true" }]);

    // Only the last release clears it.
    releaseSsh();
    await Promise.resolve();
    expect(patches).toEqual([
      { id: "agent-1", value: "true" },
      { id: "agent-1", value: "" },
    ]);
  });

  it("ignores a double release (idempotent), so early+late close handlers are safe", async () => {
    const { repo, patches } = fakeRepo();
    const presence = createSessionPresence(repo);

    const release = presence.acquire("agent-1");
    presence.acquire("agent-1"); // second connection still open
    await Promise.resolve();

    release();
    release(); // double-fire must not decrement twice
    await Promise.resolve();

    // Pin stays set: the second connection is still open.
    expect(patches).toEqual([{ id: "agent-1", value: "true" }]);
  });

  it("tracks agents independently", async () => {
    const { repo, patches } = fakeRepo();
    const presence = createSessionPresence(repo);

    presence.acquire("a");
    presence.acquire("b");
    await Promise.resolve();

    expect(patches).toEqual([
      { id: "a", value: "true" },
      { id: "b", value: "true" },
    ]);
  });
});
