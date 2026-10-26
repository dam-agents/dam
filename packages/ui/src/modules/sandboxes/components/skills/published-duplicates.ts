import type { LocalSkill, Skill, SkillPublishRecord } from "api-server-api";

export function publishedDuplicatesBySource(
  standalone: LocalSkill[],
  publishes: SkillPublishRecord[],
  skillsBySource: Record<string, Skill[]>,
): Map<string, ReadonlySet<string>> {
  const localByName = new Map(standalone.map((s) => [s.name, s]));
  const out = new Map<string, Set<string>>();
  for (const p of publishes) {
    const local = localByName.get(p.skillName);
    if (!local?.contentHash) continue;
    const scanned = skillsBySource[p.sourceId]?.find(
      (s) => s.name === p.skillName,
    );
    if (scanned?.contentHash !== local.contentHash) continue;
    let names = out.get(p.sourceId);
    if (!names) out.set(p.sourceId, (names = new Set()));
    names.add(p.skillName);
  }
  return out;
}
