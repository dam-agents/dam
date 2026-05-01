import type { Result } from "agent-runtime-api";
import { err, ok } from "agent-runtime-api";
import type { SkillsDomainError } from "agent-runtime-api";

export type SkillName = string & { readonly __brand: "SkillName" };

export function makeSkillName(value: string): Result<SkillName, SkillsDomainError> {
  if (!value) {
    return err({ kind: "InvalidSkillName", name: value, reason: "name is empty" });
  }
  if (value.includes("/") || value.includes("..") || value.startsWith(".")) {
    return err({
      kind: "InvalidSkillName",
      name: value,
      reason: "name must not contain '/', '..', or start with '.'",
    });
  }
  return ok(value as SkillName);
}
