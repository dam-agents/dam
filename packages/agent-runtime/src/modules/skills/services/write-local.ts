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

export async function runWriteLocal(
  deps: WriteLocalDeps,
  skillPaths: SkillPath[],
  input: SkillWriteLocalInput,
): Promise<Result<LocalSkill[], SkillsDomainError>> {
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
