import type { ResolvedStarterKit, SeedStamp } from "api-server-api";
import { parseKitRef } from "./requirements.js";

const COMMIT_SHA = /^[0-9a-f]{40}$/i;

export function seedStampAtApply(
  seed: NonNullable<ResolvedStarterKit["seed"]>,
): SeedStamp | undefined {
  const declaredCommit =
    seed.ref && COMMIT_SHA.test(seed.ref) ? seed.ref : undefined;
  if (declaredCommit) return undefined;
  if (!seed.commit) return undefined;
  return {
    url: seed.url,
    ...(seed.ref ? { branch: seed.ref } : {}),
    commit: seed.commit,
  };
}

export function legacySeedStamp(
  starterKit: string,
  current: { kit: ResolvedStarterKit; version: string },
): SeedStamp | undefined {
  const ref = parseKitRef(starterKit);
  const seed = current.kit.seed;
  if (!ref || !seed || seed.ref !== undefined) return undefined;
  if (!COMMIT_SHA.test(ref.version)) return undefined;
  if (seed.commit !== current.version) return undefined;
  return { url: seed.url, commit: ref.version };
}
