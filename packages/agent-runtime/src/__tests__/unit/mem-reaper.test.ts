import { describe, expect, it } from "vitest";
import { pickVictim, type ProcEntry } from "../../core/mem-reaper.js";

/**
 * TEST_OVERVIEW: victim selection is the one piece of the reaper no e2e run
 * can assert — a wrong pick SIGKILLs the harness or agent-runtime itself, and
 * the failure would look identical to the kernel OOM kill the reaper exists
 * to prevent. Everything else (cgroup reads, the interval, logging) is thin
 * I/O exercised by the manual smoke test.
 */

const ROOT = 100;

function proc(
  pid: number,
  ppid: number,
  name: string,
  rssMb: number,
): ProcEntry {
  return { pid, ppid, name, rssBytes: rssMb * 1_048_576 };
}

describe("pickVictim", () => {
  it("never picks the root or its direct children", () => {
    const table = [
      proc(1, 0, "catatonit", 1),
      proc(ROOT, 1, "agent-runtime", 900),
      proc(200, ROOT, "harness-chat", 800),
      proc(201, ROOT, "pod-service", 700),
    ];
    expect(pickVictim(table, ROOT)).toBeNull();
  });

  it("picks the largest grandchild-or-deeper descendant", () => {
    const table = [
      proc(ROOT, 1, "agent-runtime", 900),
      proc(200, ROOT, "harness-chat", 800),
      proc(300, 200, "bash", 50),
      proc(400, 300, "node", 600),
      proc(301, 200, "rg", 100),
    ];
    expect(pickVictim(table, ROOT)?.pid).toBe(400);
  });

  it("ignores processes outside the root's tree", () => {
    const table = [
      proc(1, 0, "catatonit", 1),
      proc(ROOT, 1, "agent-runtime", 100),
      proc(200, ROOT, "harness-chat", 100),
      proc(300, 200, "bash", 10),
      proc(999, 1, "orphan-hog", 5000),
    ];
    expect(pickVictim(table, ROOT)?.pid).toBe(300);
  });

  it("returns null for an empty or rootless table", () => {
    expect(pickVictim([], ROOT)).toBeNull();
    expect(pickVictim([proc(999, 1, "other", 100)], ROOT)).toBeNull();
  });
});
