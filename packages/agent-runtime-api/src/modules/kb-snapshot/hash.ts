import { createHash } from "node:crypto";

export function contentHash(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
