import type { Skill, SkillPublishRecord, SkillSource } from "api-server-api";

import { repoSlug } from "@/lib/git-source";

export interface ReadyTrackTarget {
  kind: "ready";
  source: SkillSource;
  skill: Skill;
}

export type TrackTarget =
  | ReadyTrackTarget
  | { kind: "unavailable"; sourceName: string; reason: string };

function repoIdentity(gitUrl: string): string {
  return repoSlug(gitUrl).toLowerCase();
}

export function publishTargetSources(
  publish: SkillPublishRecord,
  sources: SkillSource[],
): SkillSource[] {
  const repo = repoIdentity(publish.sourceGitUrl);
  const original = sources.filter((s) => s.id === publish.sourceId);
  const sameRepo = sources.filter(
    (s) => s.id !== publish.sourceId && repoIdentity(s.gitUrl) === repo,
  );
  return [...original, ...sameRepo];
}

export function resolveTrackTarget(
  publish: SkillPublishRecord,
  sources: SkillSource[],
  skillsBySource: Record<string, Skill[]>,
): TrackTarget {
  const candidates = publishTargetSources(publish, sources);
  for (const source of candidates) {
    const skill = skillsBySource[source.id]?.find(
      (s) => s.name === publish.skillName,
    );
    if (skill) return { kind: "ready", source, skill };
  }
  const unscanned = candidates.find((c) => skillsBySource[c.id] === undefined);
  if (unscanned) {
    return {
      kind: "unavailable",
      sourceName: unscanned.name,
      reason: `${unscanned.name} hasn't been scanned yet, so this skill's published version isn't known`,
    };
  }
  const [first] = candidates;
  if (first) {
    return {
      kind: "unavailable",
      sourceName: first.name,
      reason: `${first.name} doesn't list ${publish.skillName} yet. Refresh the source to pick up the merged pull request`,
    };
  }
  return {
    kind: "unavailable",
    sourceName: publish.sourceName,
    reason: `No skill source points at ${repoSlug(publish.sourceGitUrl)} anymore. Add it as a source to track this skill`,
  };
}
