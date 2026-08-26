import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTriggerStateStore } from "../../modules/runtime-channel/infrastructure/trigger-state-store.js";

describe("trigger state store", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "trigger-state-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps a schedule binding and an artifact binding side by side", () => {
    const store = createTriggerStateStore(dir);
    store.setSessionForSchedule("sch-1", "session-a");
    store.setSessionForArtifact("art-1", "session-b");

    expect(store.getSessionForSchedule("sch-1")).toBe("session-a");
    expect(store.getSessionForArtifact("art-1")).toBe("session-b");
    expect(createTriggerStateStore(dir).getSessionForArtifact("art-1")).toBe(
      "session-b",
    );
  });

  it("clears one artifact's binding and leaves the rest alone", () => {
    const store = createTriggerStateStore(dir);
    store.setSessionForSchedule("sch-1", "session-a");
    store.setSessionForArtifact("art-1", "session-b");
    store.setSessionForArtifact("art-2", "session-c");

    store.clearSessionForArtifact("art-1");

    expect(store.getSessionForArtifact("art-1")).toBeUndefined();
    expect(store.getSessionForArtifact("art-2")).toBe("session-c");
    expect(store.getSessionForSchedule("sch-1")).toBe("session-a");
  });

  it("reads a state file written before artifact bindings existed", () => {
    writeFileSync(
      join(dir, "trigger-state.json"),
      JSON.stringify({ scheduleSessions: { "sch-1": "session-a" } }),
    );
    const store = createTriggerStateStore(dir);

    expect(store.getSessionForSchedule("sch-1")).toBe("session-a");
    expect(store.getSessionForArtifact("art-1")).toBeUndefined();

    store.setSessionForArtifact("art-1", "session-b");
    expect(store.getSessionForSchedule("sch-1")).toBe("session-a");
    expect(store.getSessionForArtifact("art-1")).toBe("session-b");
  });
});
