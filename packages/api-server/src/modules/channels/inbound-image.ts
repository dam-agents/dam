export const READABLE_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

export type ReadableImageMimeType = (typeof READABLE_IMAGE_MIME_TYPES)[number];

export type InboundAttachment =
  | { kind: "image"; mimeType: ReadableImageMimeType }
  | { kind: "web_page" }
  | { kind: "unreadable"; description: string; retryable?: true };

function startsWith(bytes: Buffer, ...signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, i) => bytes[i] === byte);
}

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

function hasJpegFrameHeader(bytes: Buffer): boolean {
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1]!;
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      return true;
    }
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

function looksLikeSvg(head: string): boolean {
  return (
    /^<svg\b/i.test(head) || (/^<\?xml\b/i.test(head) && /<svg\b/i.test(head))
  );
}

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

function looksLikeWebPage(head: string): boolean {
  return (
    /^<(!doctype|html|head|body|\?xml)\b/i.test(head) ||
    /^\{\s*"(error|ok|needed|provided)"/.test(head)
  );
}

export function classifyInboundAttachment(bytes: Buffer): InboundAttachment {
  const mimeType = sniffImageMimeType(bytes);
  if (mimeType) return { kind: "image", mimeType };
  const head = bytes.subarray(0, 1024).toString("latin1").trimStart();
  if (!looksLikeSvg(head) && looksLikeWebPage(head))
    return { kind: "web_page" };
  return { kind: "unreadable", ...describeUnreadable(bytes) };
}
