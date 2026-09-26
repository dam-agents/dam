import { randomBytes } from "node:crypto";

export function generateSlug(): string {
  return randomBytes(10).toString("base64url");
}
