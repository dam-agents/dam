import { randomBytes, randomUUID } from "node:crypto";

export function generateSlug(): string {
  return randomBytes(10).toString("base64url");
}

export function generateId(): string {
  return randomUUID();
}
