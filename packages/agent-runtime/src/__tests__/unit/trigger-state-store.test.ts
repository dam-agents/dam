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

  it("keeps a schedule binding across a restart", () => {
    const store = createTriggerStateStore(dir);
    store.setSessionForSchedule("sch-1", "session-a");

    expect(store.getSessionForSchedule("sch-1")).toBe("session-a");
    expect(createTriggerStateStore(dir).getSessionForSchedule("sch-1")).toBe(
      "session-a",
    );
  });

  it("clears one schedule's binding and leaves the rest alone", () => {
    const store = createTriggerStateStore(dir);
    store.setSessionForSchedule("sch-1", "session-a");
    store.setSessionForSchedule("sch-2", "session-b");

    store.clearSessionForSchedule("sch-1");

    expect(store.getSessionForSchedule("sch-1")).toBeUndefined();
    expect(store.getSessionForSchedule("sch-2")).toBe("session-b");
  });

  it("reads a state file that still carries artifact bindings", () => {
    writeFileSync(
      join(dir, "trigger-state.json"),
      JSON.stringify({
        scheduleSessions: { "sch-1": "session-a" },
        artifactSessions: { "art-1": "session-b" },
      }),
    );
    const store = createTriggerStateStore(dir);

    expect(store.getSessionForSchedule("sch-1")).toBe("session-a");
  });
});
