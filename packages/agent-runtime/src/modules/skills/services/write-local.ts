import type {
  LocalSkill,
  Result,
  SkillsDomainError,
  SkillWriteLocalInput,
} from "agent-runtime-api";
import { err, ok } from "agent-runtime-api";
import {
  ensureFrontmatterName,
  parseFrontmatter,
} from "../domain/frontmatter.js";
import { makeSkillSlug, type SkillName } from "../domain/skill-name.js";
import type { SkillPath } from "../domain/skill-path.js";
import {
  MAX_FILE_BYTES,
  MAX_SKILL_BYTES,
  type LocalSkillRepository,
} from "../infrastructure/local-skill-repository.js";

export interface WriteLocalDeps {
  repo: LocalSkillRepository;
}

interface ValidatedSkill {
  name: string;
  slug: SkillName;
  content: string;
}

/**
 * Materialize user-uploaded Markdown as standalone Local Skills. Validates the
 * whole batch before writing anything (all-or-nothing): slugs, size caps, and
 * a collision check against both the batch itself and every existing Local
 * Skill. On success each file lands as `<skillPath>/<slug>/SKILL.md` with its
 * frontmatter `name:` forced to the confirmed display name.
 */
export async function runWriteLocal(
  deps: WriteLocalDeps,
  skillPaths: SkillPath[],
  input: SkillWriteLocalInput,
): Promise<Result<LocalSkill[], SkillsDomainError>> {
  // Pass 1 — per-skill validation. A bad name or oversized file fails the
  // whole batch before any write happens.
  const validated: ValidatedSkill[] = [];
  let batchBytes = 0;
  for (const skill of input.skills) {
    const slug = makeSkillSlug(skill.name);
    if (!slug.ok) return slug;
    const bytes = Buffer.byteLength(skill.content, "utf8");
    if (bytes > MAX_FILE_BYTES) {
      return err({
        kind: "PayloadTooLarge",
        detail: `${skill.name} is ${bytes} bytes (max ${MAX_FILE_BYTES})`,
      });
    }
    batchBytes += bytes;
    validated.push({
      name: skill.name,
      slug: slug.value,
      content: skill.content,
    });
  }
  if (batchBytes > MAX_SKILL_BYTES) {
    return err({
      kind: "PayloadTooLarge",
      detail: `batch exceeds ${MAX_SKILL_BYTES} bytes total`,
    });
  }

  // Pass 2 — collision check. Collect every offending display name so the
  // caller can mark all bad rows at once: within-batch slug clashes, on-disk
  // directory clashes, and display names already taken by a Local Skill
  // (installed skills are Local Skills too, so listLocal covers both).
  const existingNames = new Set(
    (await deps.repo.listLocal(skillPaths)).map((s) => s.name.trim()),
  );
  const slugCounts = new Map<string, number>();
  for (const v of validated) {
    slugCounts.set(v.slug, (slugCounts.get(v.slug) ?? 0) + 1);
  }

  const offending = new Set<string>();
  for (const v of validated) {
    if ((slugCounts.get(v.slug) ?? 0) > 1) offending.add(v.name);
    if (existingNames.has(v.name.trim())) offending.add(v.name);
    if (await deps.repo.existsInAnyPath(v.slug, skillPaths)) {
      offending.add(v.name);
    }
  }
  if (offending.size > 0) {
    return err({ kind: "SkillAlreadyExists", names: [...offending] });
  }

  // Pass 3 — materialize. Validation is complete, so the display name is the
  // returned `name`; description is whatever the final frontmatter carries.
  // The collision guard is not atomic (check-then-write) and the batch is
  // written sequentially: a concurrent same-slug mutation could be clobbered,
  // and a mid-batch I/O failure leaves earlier skills written. Tolerable here —
  // the api-server is the sole caller and the UI blocks submit while in flight.
  const created: LocalSkill[] = [];
  for (const v of validated) {
    const finalContent = ensureFrontmatterName(v.content, v.name);
    await deps.repo.writeLocalSkill(v.slug, skillPaths, finalContent);
    const { description } = parseFrontmatter(finalContent);
    created.push({
      name: v.name,
      description: description?.trim() ?? "",
      skillPath: skillPaths[0],
    });
  }
  return ok(created);
}
