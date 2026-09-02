import { randomBytes, timingSafeEqual } from "node:crypto";
import { KB_SHARE_STRING_PREFIX, parseKbShareString } from "api-server-api";

const SHARE_ID_BYTES = 6;
const SECRET_BYTES = 32;
const TOKEN_HEADER_PREFIX = "x-kb-token-";
const ROW_ID_PREFIX = "kbs-";
const SHARE_ID_PATTERN = new RegExp(`^[0-9a-f]{${SHARE_ID_BYTES * 2}}$`);

export interface ParsedShareString {
  shareId: string;
  secret: string;
}

export function mintShareId(): string {
  return randomBytes(SHARE_ID_BYTES).toString("hex");
}

export function mintShareSecret(): string {
  return randomBytes(SECRET_BYTES).toString("base64url");
}

export function formatShareString(shareId: string, secret: string): string {
  return `${KB_SHARE_STRING_PREFIX}${shareId}_${secret}`;
}

export function parseShareString(value: string): ParsedShareString | null {
  return parseKbShareString(value);
}

export function tokenHeaderName(shareId: string): string {
  return `${TOKEN_HEADER_PREFIX}${shareId}`;
}

export function shareIdFromTokenHeader(headerName: string): string | null {
  const lower = headerName.toLowerCase();
  if (!lower.startsWith(TOKEN_HEADER_PREFIX)) return null;
  const shareId = lower.slice(TOKEN_HEADER_PREFIX.length);
  return SHARE_ID_PATTERN.test(shareId) ? shareId : null;
}

export function kbShareRowId(shareId: string): string {
  return `${ROW_ID_PREFIX}${shareId}`;
}

export function shareIdFromRowId(rowId: string): string {
  return rowId.startsWith(ROW_ID_PREFIX)
    ? rowId.slice(ROW_ID_PREFIX.length)
    : rowId;
}

export function secretsEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
