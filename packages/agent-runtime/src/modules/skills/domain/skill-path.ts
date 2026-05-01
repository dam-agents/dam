import type { Result, SkillsDomainError } from "agent-runtime-api";
import { err, ok } from "agent-runtime-api";

export type SkillPath = string & { readonly __brand: "SkillPath" };

export function makeSkillPath(value: string): Result<SkillPath, SkillsDomainError> {
  if (!value.startsWith("/")) {
    return err({ kind: "InvalidSkillPath", path: value, reason: "path must be absolute" });
  }
  return ok(value as SkillPath);
}

export function makeSkillPaths(values: string[]): Result<SkillPath[], SkillsDomainError> {
  const out: SkillPath[] = [];
  for (const v of values) {
    const r = makeSkillPath(v);
    if (!r.ok) return r;
    out.push(r.value);
  }
  return ok(out);
}
