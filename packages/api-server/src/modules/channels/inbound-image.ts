/** Inbound attachment bytes, classified by what they actually are rather than
 *  by what the messenger said they were.
 *
 *  A channel attachment only helps the agent if the harness can decode it: it
 *  resizes every inbound image to the model's pixel/byte limits and reads the
 *  dimensions from the file header to do so. Handed anything else — a web page
 *  a file download quietly returned instead of the file, or a format it has no
 *  decoder for — it fails that step and replaces the picture with an internal
 *  error the agent then reports as its answer (#3008). So the bytes are
 *  classified here, before they ever become a prompt block.
 */

/** The formats every harness can decode. Deliberately the model's own set —
 *  PNG, JPEG, GIF, WebP — not "whatever the messenger labelled `image/*`". */
export const READABLE_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

export type ReadableImageMimeType = (typeof READABLE_IMAGE_MIME_TYPES)[number];

export type InboundAttachment =
  /** Decodable image bytes. `mimeType` is sniffed, so a mislabelled-but-valid
   *  upload still reaches the agent under its real type. */
  | { kind: "image"; mimeType: ReadableImageMimeType }
  /** Markup, not a file: the hallmark of a download that returned an error or
   *  sign-in page with a 200 status instead of the bytes. */
  | { kind: "web_page" }
  /** Real bytes in a format no harness can decode. `description` names it in
   *  words a sender can act on. */
  | { kind: "unreadable"; description: string };

function startsWith(bytes: Buffer, ...signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, i) => bytes[i] === byte);
}

/** A signature alone isn't enough: the harness reads width and height out of
 *  the header, so bytes that stop short of one (a truncated download) fail the
 *  same way an unknown format does. These minimums are the harness's own. */
function sniffImageMimeType(bytes: Buffer): ReadableImageMimeType | null {
  if (
    startsWith(bytes, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) &&
    bytes.length >= 24
  ) {
    return "image/png";
  }
  if (startsWith(bytes, 0xff, 0xd8, 0xff) && bytes.length >= 10) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 10 &&
    /^GIF8[79]a$/.test(bytes.toString("latin1", 0, 6))
  ) {
    return "image/gif";
  }
  if (
    bytes.length >= 30 &&
    bytes.toString("latin1", 0, 4) === "RIFF" &&
    bytes.toString("latin1", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/** The ISO base-media container (`ftyp`) named in words — HEIC photos straight
 *  off a phone are the common one, AVIF the coming one. */
function describeIsoMedia(bytes: Buffer): string | null {
  if (bytes.length < 12 || bytes.toString("latin1", 4, 8) !== "ftyp") {
    return null;
  }
  const brand = bytes.toString("latin1", 8, 12).trim().toLowerCase();
  if (/^(heic|heix|heif|hevc|mif1|msf1)/.test(brand)) {
    return "an HEIC/HEIF photo";
  }
  if (brand.startsWith("avif")) return "an AVIF image";
  return `a \`${brand}\` media file`;
}

function describeUnreadable(bytes: Buffer): string {
  const iso = describeIsoMedia(bytes);
  if (iso) return iso;
  if (bytes.length === 0) return "an empty file";
  if (startsWith(bytes, 0x42, 0x4d)) return "a BMP image";
  if (startsWith(bytes, 0x49, 0x49, 0x2a, 0x00)) return "a TIFF image";
  if (startsWith(bytes, 0x4d, 0x4d, 0x00, 0x2a)) return "a TIFF image";
  if (startsWith(bytes, 0x25, 0x50, 0x44, 0x46)) return "a PDF";
  if (startsWith(bytes, 0x00, 0x00, 0x01, 0x00)) return "a Windows icon";
  const hex = bytes
    .subarray(0, 4)
    .toString("hex")
    .replace(/(..)/g, "$1 ")
    .trim();
  return `unrecognized data (it starts with ${hex})`;
}

/** Whether the bytes are text markup — HTML, XML/SVG or JSON. Slack answers a
 *  file request it won't serve with a 200 and a page, so this is what a
 *  permission problem looks like from here, not an HTTP error. */
function looksLikeWebPage(bytes: Buffer): boolean {
  const head = bytes.subarray(0, 512).toString("latin1").trimStart();
  return (
    /^<(!doctype|html|head|body|\?xml|svg)\b/i.test(head) ||
    /^\{\s*"(error|ok|needed|provided)"/.test(head)
  );
}

export function classifyInboundAttachment(bytes: Buffer): InboundAttachment {
  const mimeType = sniffImageMimeType(bytes);
  if (mimeType) return { kind: "image", mimeType };
  if (looksLikeWebPage(bytes)) return { kind: "web_page" };
  return { kind: "unreadable", description: describeUnreadable(bytes) };
}
