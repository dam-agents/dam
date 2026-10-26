import { describe, expect, test } from "vitest";

import {
  type SaveFileDeps,
  saveFileDraft,
} from "../../modules/files/lib/save-file.js";

function fakeDisk(content: string, mtimeMs: number) {
  const disk = { content, mtimeMs };
  const write: SaveFileDeps["write"] = async (input) => {
    if (
      input.expectedMtimeMs !== undefined &&
      input.expectedMtimeMs !== disk.mtimeMs
    ) {
      throw new Error("File changed on disk since it was read");
    }
    disk.content = input.content;
    disk.mtimeMs += 1;
    return { mtimeMs: disk.mtimeMs };
  };
  return { disk, write };
}

describe("saveFileDraft", () => {
  test("a cancelled overwrite keeps the conflict for the next save", async () => {
    const { disk, write } = fakeDisk("a\n", 100);
    const base = 100;
    disk.content = "a\nagent line\n";
    disk.mtimeMs = 200;

    let confirms = 0;
    const deps: SaveFileDeps = {
      write,
      confirmOverwrite: async () => {
        confirms++;
        return false;
      },
    };

    const first = await saveFileDraft("a\nmy line\n", base, deps);
    expect(first).toEqual({ kind: "kept" });

    const second = await saveFileDraft("a\nmy line\n", base, deps);
    expect(second).toEqual({ kind: "kept" });
    expect(confirms).toBe(2);
    expect(disk.content).toBe("a\nagent line\n");
  });

  test("a confirmed overwrite writes the draft", async () => {
    const { disk, write } = fakeDisk("a\n", 100);
    disk.mtimeMs = 200;
    const out = await saveFileDraft("mine\n", 100, {
      write,
      confirmOverwrite: async () => true,
    });
    expect(out).toEqual({ kind: "saved", mtimeMs: 201 });
    expect(disk.content).toBe("mine\n");
  });

  test("a non-conflict error is reported, not confirmed", async () => {
    const out = await saveFileDraft("x", 1, {
      write: async () => {
        throw new Error("disk full");
      },
      confirmOverwrite: async () => {
        throw new Error("must not ask");
      },
    });
    expect(out).toEqual({ kind: "failed", message: "disk full" });
  });
});
