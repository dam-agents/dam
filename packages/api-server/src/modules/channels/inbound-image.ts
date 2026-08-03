/** Inbound attachment bytes, classified by what they actually are rather than
 *  by what the messenger said they were.
 *
 *  A channel attachment only helps the agent if the harness can decode it: it
 *  resizes every inbound image to the model's pixel/byte limits and reads the
 *  dimensions from the file header to do so. Handed anything else — a web page
 *  a file download quietly returned instead of the file, or a format it has no
 *  decoder for — it fails that step and substitutes an internal error message
 *  for the picture, which the agent then reports as its answer. Downloads fail
 *  this way rather than loudly: a messenger that won't serve a file answers
 *  with a 200 and a sign-in page, so the bytes are classified here, before they
 *  ever become a prompt block, and a rejected attachment is explained in terms
 *  of what actually arrived.
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
   *  sign-in page with a 200 status instead of the bytes. SVG is deliberately
   *  *not* this — see `looksLikeSvg`. */
  | { kind: "web_page" }
  /** Real bytes in a format no harness can decode. `description` names it in
   *  words a sender can act on. `retryable` marks the ones that are a broken
   *  transfer rather than an unsupported format, so the notice says "resend"
   *  instead of listing formats the file already was. */
  | { kind: "unreadable"; description: string; retryable?: true };

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
  if (startsWith(bytes, 0xff, 0xd8, 0xff) && hasJpegFrameHeader(bytes)) {
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

/** Whether a JPEG carries the start-of-frame segment its dimensions live in.
 *  Unlike PNG or WebP, JPEG keeps them in a marker chain rather than at a fixed
 *  offset, so the signature says nothing about whether they arrived: a transfer
 *  cut off inside a large EXIF block is as unreadable as an unknown format.
 *  Walks the chain the way the harness's own header parser does. */
function hasJpegFrameHeader(bytes: Buffer): boolean {
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1]!;
    // Fill bytes (a run of 0xff) precede the real marker.
    if (marker === 0xff) {
      i++;
      continue;
    }
    // SOF0–SOF15 carry width and height; 0xc4/0xc8/0xcc are tables, not frames.
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      return true;
    }
    // Standalone markers (restart, SOI/EOI, TEM) carry no length field.
    if ((marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) {
      i += 2;
      continue;
    }
    const length = bytes.readUInt16BE(i + 2);
    if (length < 2) return false;
    i += 2 + length;
  }
  return false;
}

/** Whether the bytes are an SVG. It is markup, but it is also a picture the
 *  sender meant to send — an unsupported *format*, not a download that failed.
 *  Kept apart from `looksLikeWebPage` so the notice never blames a missing
 *  permission for a file that arrived intact. */
function looksLikeSvg(head: string): boolean {
  return (
    /^<svg\b/i.test(head) || (/^<\?xml\b/i.test(head) && /<svg\b/i.test(head))
  );
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

function describeUnreadable(bytes: Buffer): {
  description: string;
  retryable?: true;
} {
  const iso = describeIsoMedia(bytes);
  if (iso) return { description: iso };
  if (bytes.length === 0)
    return { description: "an empty file", retryable: true };
  // A signature with no dimensions behind it is a transfer that stopped early,
  // not a format the sender chose — worth telling them to resend.
  if (startsWith(bytes, 0x89, 0x50, 0x4e, 0x47)) {
    return {
      description: "a PNG that was cut off before its dimensions",
      retryable: true,
    };
  }
  if (startsWith(bytes, 0xff, 0xd8, 0xff)) {
    return {
      description: "a JPEG that was cut off before its dimensions",
      retryable: true,
    };
  }
  const svgHead = bytes.subarray(0, 1024).toString("latin1").trimStart();
  if (looksLikeSvg(svgHead)) return { description: "an SVG image" };
  if (startsWith(bytes, 0x42, 0x4d)) return { description: "a BMP image" };
  if (startsWith(bytes, 0x49, 0x49, 0x2a, 0x00))
    return { description: "a TIFF image" };
  if (startsWith(bytes, 0x4d, 0x4d, 0x00, 0x2a))
    return { description: "a TIFF image" };
  if (startsWith(bytes, 0x25, 0x50, 0x44, 0x46))
    return { description: "a PDF" };
  if (startsWith(bytes, 0x00, 0x00, 0x01, 0x00))
    return { description: "a Windows icon" };
  const hex = bytes
    .subarray(0, 4)
    .toString("hex")
    .replace(/(..)/g, "$1 ")
    .trim();
  return { description: `unrecognized data (it starts with ${hex})` };
}

/** Whether the bytes are a served page rather than a file — HTML, an XML error
 *  body, or a JSON API error. Slack answers a file request it won't serve with
 *  a 200 and a sign-in page, so this is what a permission problem looks like
 *  from here, not an HTTP error. */
function looksLikeWebPage(head: string): boolean {
  return (
    /^<(!doctype|html|head|body|\?xml)\b/i.test(head) ||
    /^\{\s*"(error|ok|needed|provided)"/.test(head)
  );
}

export function classifyInboundAttachment(bytes: Buffer): InboundAttachment {
  const mimeType = sniffImageMimeType(bytes);
  if (mimeType) return { kind: "image", mimeType };
  // SVG is markup but not a failed download, so it is classified as the
  // unsupported format it is — ahead of the web-page check, which its `<?xml`
  // prologue would otherwise match.
  const head = bytes.subarray(0, 1024).toString("latin1").trimStart();
  if (!looksLikeSvg(head) && looksLikeWebPage(head))
    return { kind: "web_page" };
  return { kind: "unreadable", ...describeUnreadable(bytes) };
}
