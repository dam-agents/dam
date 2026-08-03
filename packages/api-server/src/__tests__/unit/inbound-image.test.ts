import { describe, it, expect } from "vitest";
import { deflateSync } from "node:zlib";
import { classifyInboundAttachment } from "../../modules/channels/inbound-image.js";

/** A real (if tiny) PNG: the harness reads width/height straight out of these
 *  header bytes, so a hand-rolled signature would not prove anything. */
function png(width: number, height: number): Buffer {
  const crcTable: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(height * (1 + width * 3));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A real (if minimal) JPEG: a signature alone is not enough, because the
 *  harness reads the dimensions out of the start-of-frame segment this builds. */
function jpeg(width: number, height: number): Buffer {
  const app0 = Buffer.concat([
    Buffer.from([0xff, 0xe0, 0x00, 0x10]),
    Buffer.from("JFIF\0"),
    Buffer.alloc(9),
  ]);
  const sof = Buffer.alloc(19);
  sof.writeUInt8(0xff, 0);
  sof.writeUInt8(0xc0, 1); // SOF0
  sof.writeUInt16BE(17, 2);
  sof.writeUInt8(8, 4); // sample precision
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof.writeUInt8(3, 9); // component count
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(8)]);
}

function isoMedia(brand: string): Buffer {
  const head = Buffer.alloc(12);
  head.writeUInt32BE(12, 0);
  head.write("ftyp", 4, "ascii");
  head.write(brand, 8, "ascii");
  return head;
}

describe("inbound attachment classification", () => {
  it("accepts the four formats every harness decodes", () => {
    expect(classifyInboundAttachment(png(4, 4))).toEqual({
      kind: "image",
      mimeType: "image/png",
    });
    expect(classifyInboundAttachment(jpeg(8, 8))).toEqual({
      kind: "image",
      mimeType: "image/jpeg",
    });
    expect(classifyInboundAttachment(Buffer.from("GIF89a\0\0"))).toEqual({
      kind: "image",
      mimeType: "image/gif",
    });
    expect(
      classifyInboundAttachment(
        Buffer.concat([
          Buffer.from("RIFF"),
          Buffer.from([0, 0, 0, 0]),
          Buffer.from("WEBPVP8 "),
          Buffer.alloc(18),
        ]),
      ),
    ).toEqual({ kind: "image", mimeType: "image/webp" });
  });

  it("treats a header-truncated image as unreadable, not as an image", () => {
    // A partial download keeps the signature but loses the dimensions the
    // harness reads — forwarded, it fails exactly like an unknown format.
    const truncated = png(64, 64).subarray(0, 20);
    expect(classifyInboundAttachment(truncated).kind).toBe("unreadable");
  });

  it("reads the type off the bytes, not the sender's label", () => {
    // Slack calls a screenshot whatever the uploading client claimed; only the
    // bytes decide what the agent is told it is looking at.
    const classified = classifyInboundAttachment(png(2, 2));
    expect(classified).toEqual({ kind: "image", mimeType: "image/png" });
  });

  it("calls out a web page — a 200-with-markup file download", () => {
    const signInPage = Buffer.from(
      "<!DOCTYPE html>\n<html><body>You are not authorized</body></html>",
    );
    expect(classifyInboundAttachment(signInPage)).toEqual({ kind: "web_page" });
    expect(
      classifyInboundAttachment(
        Buffer.from('{"ok":false,"error":"not_authed"}'),
      ),
    ).toEqual({ kind: "web_page" });
    expect(
      classifyInboundAttachment(Buffer.from("  \n<html><head></head></html>")),
    ).toEqual({ kind: "web_page" });
  });

  it("names formats no harness decodes so the sender can convert them", () => {
    expect(classifyInboundAttachment(isoMedia("heic"))).toEqual({
      kind: "unreadable",
      description: "an HEIC/HEIF photo",
    });
    expect(classifyInboundAttachment(isoMedia("avif"))).toEqual({
      kind: "unreadable",
      description: "an AVIF image",
    });
    expect(classifyInboundAttachment(Buffer.from("BM....."))).toEqual({
      kind: "unreadable",
      description: "a BMP image",
    });
    expect(classifyInboundAttachment(Buffer.from("%PDF-1.7"))).toEqual({
      kind: "unreadable",
      description: "a PDF",
    });
  });

  it("describes unknown and empty bytes without pretending they are images", () => {
    const unknown = classifyInboundAttachment(
      Buffer.from([0x01, 0x02, 0x03, 0x04]),
    );
    expect(unknown.kind).toBe("unreadable");
    expect(unknown).toMatchObject({
      description: expect.stringContaining("01 02 03 04"),
    });

    expect(classifyInboundAttachment(Buffer.alloc(0))).toEqual({
      kind: "unreadable",
      description: "an empty file",
      retryable: true,
    });
  });

  it("rejects a truncated PNG signature rather than passing a headerless file", () => {
    // Fewer bytes than the harness needs to read dimensions from. Named as the
    // interrupted transfer it is, so the sender is told to resend rather than
    // to convert a format that was already right.
    expect(classifyInboundAttachment(Buffer.from([137, 80, 78, 71]))).toEqual({
      kind: "unreadable",
      description: "a PNG that was cut off before its dimensions",
      retryable: true,
    });
  });

  it("rejects a JPEG cut off before its start-of-frame segment", () => {
    // JPEG keeps its dimensions in a marker chain, not at a fixed offset, so a
    // transfer that dies inside a long EXIF block still carries a valid
    // signature. The harness cannot read that, so neither do we.
    const headerless = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x28]),
      Buffer.alloc(40),
    ]);
    expect(classifyInboundAttachment(headerless)).toEqual({
      kind: "unreadable",
      description: "a JPEG that was cut off before its dimensions",
      retryable: true,
    });
  });

  it("treats an SVG as an unsupported format, not as a failed download", () => {
    // Slack labels .svg uploads image/svg+xml, so they reach classification —
    // and an SVG's `<?xml` prologue would otherwise read as the sign-in page a
    // permission problem returns, blaming a scope for a file that arrived fine.
    const withProlog = Buffer.from(
      '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>',
    );
    const bare = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    for (const svg of [withProlog, bare]) {
      expect(classifyInboundAttachment(svg)).toEqual({
        kind: "unreadable",
        description: "an SVG image",
      });
    }
  });
});
