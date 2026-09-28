import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { planPersistedMoves } from "../../modules/agents/domain/runtime-migration.js";

/**
 * TEST_OVERVIEW: A runtime migration rewrites a persisted mount from outside
 * HOME to the same path below HOME's persisted directory, and the machine's
 * guest points the old path at exactly that directory on every boot. The VM
 * runner and the controller hold their copy of the directory to the guest
 * contract; this is the same hold for the api-server's, so a rename on either
 * side fails here rather than as a link to an empty directory.
 */

const guest = JSON.parse(
  readFileSync(
    new URL("../../../../vm-runner/contract/guest.json", import.meta.url),
    "utf8",
  ),
) as { agentHome: string; persistedDir: string };

describe("the persisted directory a migration moves paths into", () => {
  // TEST_SCENARIO: /data moves to the guest contract's persisted directory, which is below the guest's home.
  it("is the one the guest links moved paths to", () => {
    const { moves } = planPersistedMoves({
      name: "a",
      image: "img",
      mounts: [{ path: "/data", persist: true }],
    });
    expect(moves).toEqual({ "/data": `${guest.persistedDir}/data` });
    expect(guest.persistedDir.startsWith(`${guest.agentHome}/`)).toBe(true);
  });
});
