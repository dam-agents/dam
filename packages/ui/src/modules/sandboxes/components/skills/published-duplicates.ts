import type {
  LocalSkill,
  Skill,
  SkillPublishRecord,
  SkillSource,
} from "api-server-api";

import { publishTargetSources } from "./publish-target.js";

export function publishedDuplicatesBySource(
  standalone: LocalSkill[],
  publishes: SkillPublishRecord[],
  sources: SkillSource[],
  skillsBySource: Record<string, Skill[]>,
): Map<string, ReadonlySet<string>> {
  const localByName = new Map(standalone.map((s) => [s.name, s]));
  const out = new Map<string, Set<string>>();
  for (const p of publishes) {
    const local = localByName.get(p.skillName);
    if (!local?.contentHash) continue;
    for (const source of publishTargetSources(p, sources)) {
      const scanned = skillsBySource[source.id]?.find(
        (s) => s.name === p.skillName,
      );
      if (scanned?.contentHash !== local.contentHash) continue;
      let names = out.get(source.id);
      if (!names) out.set(source.id, (names = new Set()));
      names.add(p.skillName);
    }
  }
  return out;
}
