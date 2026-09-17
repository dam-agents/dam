import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  pickVictim,
  readMeminfoBytes,
  type ProcEntry,
} from "../../core/mem-reaper.js";

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

// TEST_SCENARIO: a machine on the vm Backend has no cgroup limit, so the reaper
// TEST_SCENARIO: reads the kernel's own numbers instead. MemAvailable is the one
// TEST_SCENARIO: it must use: it already discounts the page cache the kernel
// TEST_SCENARIO: hands back under pressure, while MemFree does not. On a guest
// TEST_SCENARIO: holding hundreds of megabytes of cache, keying on MemFree would
// TEST_SCENARIO: read as near-full and reap on an idle machine.
describe("readMeminfoBytes", () => {
  const meminfo = join(mkdtempSync(join(tmpdir(), "meminfo-")), "meminfo");
  writeFileSync(
    meminfo,
    [
      "MemTotal:        2074964 kB",
      "MemFree:          158000 kB",
      "MemAvailable:    1527552 kB",
      "Cached:           741000 kB",
      "",
    ].join("\n"),
  );

  it("reads a key as bytes", () => {
    expect(readMeminfoBytes("MemTotal", meminfo)).toBe(2074964 * 1024);
    expect(readMeminfoBytes("MemAvailable", meminfo)).toBe(1527552 * 1024);
  });

  it("does not confuse MemFree with MemAvailable", () => {
    const total = readMeminfoBytes("MemTotal", meminfo) ?? 0;
    const available = readMeminfoBytes("MemAvailable", meminfo) ?? 0;
    const free = readMeminfoBytes("MemFree", meminfo) ?? 0;
    expect((total - available) / total).toBeLessThan(0.3);
    expect((total - free) / total).toBeGreaterThan(0.9);
  });

  it("is null for an absent key or file", () => {
    expect(readMeminfoBytes("Nope", meminfo)).toBeNull();
    expect(readMeminfoBytes("MemTotal", `${meminfo}.missing`)).toBeNull();
  });
});
