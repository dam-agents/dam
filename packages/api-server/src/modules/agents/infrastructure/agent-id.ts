import crypto from "node:crypto";

export function newAgentId(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(8).toString("hex")}`;
}
