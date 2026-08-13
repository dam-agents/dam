import crypto from "node:crypto";

export function generateK8sName(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(8).toString("hex")}`;
}
