import { describe, expect, test } from "vitest";

import {
  buildBundle,
  type BundleEntry,
} from "../../modules/files/api/import-bundle.js";

type ParsedEntry = { path: string; type: string; content: string };

function readString(block: Uint8Array, offset: number, length: number) {
  const field = block.subarray(offset, offset + length);
  const end = field.indexOf(0);
  return new TextDecoder().decode(end === -1 ? field : field.subarray(0, end));
}

function parsePaxRecords(data: Uint8Array): Map<string, string> {
  const records = new Map<string, string>();
  let offset = 0;
  while (offset < data.byteLength) {
    const space = data.indexOf(0x20, offset);
    const length = Number(
      new TextDecoder().decode(data.subarray(offset, space)),
    );
    const record = new TextDecoder().decode(
      data.subarray(space + 1, offset + length - 1),
    );
    expect(data[offset + length - 1]).toBe(0x0a);
    const eq = record.indexOf("=");
    records.set(record.slice(0, eq), record.slice(eq + 1));
    offset += length;
  }
  return records;
}

async function parseTar(blob: Blob): Promise<ParsedEntry[]> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const entries: ParsedEntry[] = [];
  let paxPath: string | undefined;
  let offset = 0;
  while (offset + 512 <= bytes.byteLength) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const size = parseInt(readString(header, 124, 12), 8);
    const type = String.fromCharCode(header[156]);
    const data = bytes.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === "x") {
      paxPath = parsePaxRecords(data).get("path");
      continue;
    }
    const name = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    const ustarPath = prefix ? `${prefix}/${name}` : name;
    entries.push({
      path: paxPath ?? ustarPath,
      type,
      content: new TextDecoder().decode(data),
    });
    paxPath = undefined;
  }
  return entries;
}

function entry(path: string, content = path): BundleEntry {
  return { path, file: new File([content], path.split("/").pop() ?? path) };
}

describe("buildBundle", () => {
  test("keeps short and prefix-splittable paths in the USTAR header", async () => {
    const nested = `${"segment-".repeat(12)}dir/file.txt`;
    const tar = await parseTar(
      await buildBundle([entry("project/a.txt"), entry(nested)]),
    );

    expect(tar).toEqual([
      { path: "project/a.txt", type: "0", content: "project/a.txt" },
      { path: nested, type: "0", content: nested },
    ]);
  });

  test("carries paths USTAR cannot hold in a PAX path record", async () => {
    const deep = `project/${"a-long-directory-name/".repeat(14)}notes.md`;
    const longName = `project/${"n".repeat(120)}.txt`;
    const tar = await parseTar(
      await buildBundle([entry(deep), entry(longName), entry("project/b.txt")]),
    );

    expect(tar).toEqual([
      { path: deep, type: "0", content: deep },
      { path: longName, type: "0", content: longName },
      { path: "project/b.txt", type: "0", content: "project/b.txt" },
    ]);
  });

  test("measures USTAR limits in bytes, not characters", async () => {
    const fitsInChars = `project/${"ř".repeat(60)}.txt`;
    const tar = await parseTar(await buildBundle([entry(fitsInChars)]));

    expect(tar).toEqual([
      { path: fitsInChars, type: "0", content: fitsInChars },
    ]);
  });

  test("sizes a PAX record whose length gains a digit", async () => {
    const paths = [1, 2, 3, 4, 5, 6].map(
      (n) => `${"dir/".repeat(247)}${"x".repeat(n)}`,
    );
    const tar = await parseTar(await buildBundle(paths.map((p) => entry(p))));

    expect(tar.map((e) => e.path)).toEqual(paths);
  });
});
