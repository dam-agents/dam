import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HOME_VOLUME_FULL_REASON,
  isHomeVolumeFull,
  readHomeVolume,
  reportHomeVolumeFullOnCrash,
} from "../../core/home-volume-full.js";

/**
 * TEST_OVERVIEW: a crash on a full home volume must leave the reason in the
 * container's termination message, the only text the controller reads from a
 * dead container, and must not claim a full home for a crash with another
 * cause or an ENOSPC from a volume that still has room.
 */

function enospc(): NodeJS.ErrnoException {
  return Object.assign(new Error("ENOSPC: no space left on device, write"), {
    code: "ENOSPC",
  });
}

describe("isHomeVolumeFull", () => {
  it("names a full home for ENOSPC when the home has almost no room", () => {
    expect(isHomeVolumeFull(enospc(), "/home", () => 4096)).toBe(true);
  });

  it("does not for ENOSPC while the home still has room", () => {
    expect(isHomeVolumeFull(enospc(), "/home", () => 5 * 1024 ** 3)).toBe(
      false,
    );
  });

  it("does not for other errors or an unreadable home", () => {
    expect(isHomeVolumeFull(new Error("boom"), "/home", () => 0)).toBe(false);
    expect(isHomeVolumeFull(enospc(), "/home", () => null)).toBe(false);
  });
});

describe("readHomeVolume", () => {
  it("reports the free and total bytes of the volume holding the home", async () => {
    const volume = await readHomeVolume(tmpdir());
    expect(volume).not.toBeNull();
    expect(volume!.totalBytes).toBeGreaterThan(0);
    expect(volume!.freeBytes).toBeLessThanOrEqual(volume!.totalBytes);
    expect(volume!.full).toBe(volume!.freeBytes < 64 * 1024 * 1024);
  });

  it("reports nothing for a home it cannot read", async () => {
    expect(await readHomeVolume(join(tmpdir(), "no-such-home-xyz"))).toBe(null);
  });
});

describe("reportHomeVolumeFullOnCrash", () => {
  let stop: (() => void) | undefined;
  afterEach(() => stop?.());

  function terminationLog(): string {
    const path = join(mkdtempSync(join(tmpdir(), "term-")), "termination-log");
    writeFileSync(path, "");
    return path;
  }

  it("writes the reason when the crash is a full home", () => {
    const log = terminationLog();
    stop = reportHomeVolumeFullOnCrash("/home", {
      terminationLog: log,
      free: () => 0,
    });
    process.emit("uncaughtExceptionMonitor", enospc(), "uncaughtException");
    expect(readFileSync(log, "utf8")).toBe(HOME_VOLUME_FULL_REASON);
  });

  it("leaves the termination message alone for any other crash", () => {
    const log = terminationLog();
    stop = reportHomeVolumeFullOnCrash("/home", {
      terminationLog: log,
      free: () => 0,
    });
    process.emit(
      "uncaughtExceptionMonitor",
      new Error("boom"),
      "uncaughtException",
    );
    expect(readFileSync(log, "utf8")).toBe("");
  });

  it("does not create a termination log the container was not given", () => {
    const missing = join(mkdtempSync(join(tmpdir(), "term-")), "absent");
    stop = reportHomeVolumeFullOnCrash("/home", {
      terminationLog: missing,
      free: () => 0,
    });
    expect(() =>
      process.emit("uncaughtExceptionMonitor", enospc(), "uncaughtException"),
    ).not.toThrow();
    expect(() => readFileSync(missing)).toThrow();
  });
});
