import type { LocalSkill, Skill, SkillPublishRecord } from "api-server-api";

/**
 * Per source id, the scanned skill names whose entry is the same file the
 * "Created in this sandbox" row already shows — so rendering both would have the
 * page assert that one skill both exists and is not installed (#3019).
 *
 * Two conditions, and both are observable facts rather than beliefs about
 * GitHub: we published this skill to *this* source (provenance), and the source
 * now serves byte-identical content (proof it landed). Deliberately **not**
 * gated on `prState === "merged"`: that is only a proxy for the second
 * condition, and a lagging one — it would leave the duplicate on screen from the
 * moment a pull request merges until the resolver next looks, which the hourly
 * re-check can stretch past an hour.
 *
 * The false positives this still has to avoid, and does: an unrelated same-named
 * catalog skill differs in hash; a local copy that merely happens to duplicate a
 * source skill has no publish record for that source; and a locally edited copy
 * differs in hash, so both rows show — which is correct, they are different
 * content. An absent local hash never suppresses, since it cannot prove a match.
 */
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
