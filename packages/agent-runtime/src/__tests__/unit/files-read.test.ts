import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFilesService } from "../../modules/files.js";

// TEST_OVERVIEW: readFileSafe decides whether a workspace file is text or
// binary. The file-type library reports an `<?xml ` declaration as a detected
// type, but XML-family files are plain text on disk. The service must keep
// those readable and editable while still refusing to decode real binaries,
// which the UI would otherwise render as broken characters.

describe("readFileSafe text and binary classification", () => {
  let work: string;
  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), "files-read-"));
  });
  afterEach(() => rmSync(work, { recursive: true, force: true }));

  const read = async (rel: string) => {
    const result = await createFilesService(work).readFileSafe(rel);
    if (!result.ok) throw new Error(`read failed: ${result.error.kind}`);
    return result.value;
  };

  // TEST_SCENARIO: An SVG written with the usual XML declaration is the file an
  // agent produces for a chart. It must read as text so the file panel can edit
  // it and promote it to an artifact.
  it("reads an SVG with an XML declaration as text", async () => {
    const svg = '<?xml version="1.0" encoding="UTF-8"?>\n<svg></svg>\n';
    writeFileSync(join(work, "chart.svg"), svg);

    const file = await read("chart.svg");

    expect(file.binary).toBe(false);
    expect(file.mimeType).toBe("image/svg+xml");
    expect(file.content).toBe(svg);
  });

  // TEST_SCENARIO: The same declaration on a plain .xml file takes the XML mime
  // type from the extension branch rather than the detection.
  it("reads a declared XML document as text", async () => {
    writeFileSync(join(work, "pom.xml"), '<?xml version="1.0"?>\n<project/>\n');

    const file = await read("pom.xml");

    expect(file.binary).toBe(false);
    expect(file.mimeType).toBe("application/xml");
  });

  // TEST_SCENARIO: An SVG without the declaration already worked before this
  // rule existed; both spellings must now agree.
  it("reads an SVG without a declaration as the same text result", async () => {
    writeFileSync(join(work, "plain.svg"), "<svg></svg>\n");

    const file = await read("plain.svg");

    expect(file.binary).toBe(false);
    expect(file.mimeType).toBe("image/svg+xml");
  });

  // TEST_SCENARIO: A detected format that really is binary must stay binary —
  // the XML carve-out must not widen into every detection.
  it("keeps a PNG binary and base64-encoded", async () => {
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    writeFileSync(join(work, "logo.png"), png);

    const file = await read("logo.png");

    expect(file.binary).toBe(true);
    expect(file.mimeType).toBe("image/png");
    expect(file.content).toBe(png.toString("base64"));
  });

  // TEST_SCENARIO: A file with no detected format but null bytes in it cannot be
  // decoded as UTF-8, so the null-byte check stays authoritative.
  it("keeps an undetected file with null bytes binary", async () => {
    writeFileSync(join(work, "blob.dat"), Buffer.from([0x61, 0x00, 0x62]));

    const file = await read("blob.dat");

    expect(file.binary).toBe(true);
    expect(file.mimeType).toBe("application/octet-stream");
  });
});
