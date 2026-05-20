import type { z } from "zod";
import type {
  localSkillSchema,
  skillCreateSourceInputSchema,
  skillInstallInputSchema,
  skillPublishInputSchema,
  skillPublishResultSchema,
  skillRefSchema,
  skillSchema,
  skillSourceSchema,
  skillUninstallInputSchema,
} from "./schemas.js";

export type SkillRef = z.infer<typeof skillRefSchema>;
export type SkillSource = z.infer<typeof skillSourceSchema>;
export type Skill = z.infer<typeof skillSchema>;
export type LocalSkill = z.infer<typeof localSkillSchema>;

export type SkillCreateSourceInput = z.infer<
  typeof skillCreateSourceInputSchema
>;

export type SkillInstallInput = z.infer<typeof skillInstallInputSchema>;

export type SkillUninstallInput = z.infer<typeof skillUninstallInputSchema>;

export type SkillPublishInput = z.infer<typeof skillPublishInputSchema>;

export type SkillPublishResult = z.infer<typeof skillPublishResultSchema>;

/**
 * Explicit record of a publish event. Written on a successful
 * `publish` call into the Postgres `instance_skill_publishes`
 * table. Drives the `Published` badge + "View PR" link in the UI —
 * the name-match heuristic it replaces had confusing false positives
 * when a local skill happened to share a name with a catalog entry.
 *
 * Source fields are denormalized so the record stays usable after the
 * source is renamed or deleted.
 */
export interface SkillPublishRecord {
  skillName: string;
  sourceId: string;
  sourceName: string;
  sourceGitUrl: string;
  prUrl: string;
  publishedAt: string; // ISO 8601
}

/** Reconciled view of an instance's skills: both the installed (tracked in
 *  Postgres `instance_skills` AND present on disk) and the standalone (on
 *  disk but not tracked). Computing this in one pass lets the server drop
 *  ghost SkillRefs — entries whose directories were deleted out-of-band —
 *  and persist the cleanup so the declarative state stops drifting from the
 *  filesystem.
 *
 *  `instancePublishes` carries the publish history for this instance so the
 *  UI can light up the "Published" badge on exactly the skills the user
 *  actually pushed. */
export interface SkillsState {
  installed: SkillRef[];
  standalone: LocalSkill[];
  instancePublishes: SkillPublishRecord[];
}

export interface SkillsService {
  listSources: (agentId?: string) => Promise<SkillSource[]>;
  getSource: (id: string) => Promise<SkillSource | null>;
  createSource: (input: SkillCreateSourceInput) => Promise<SkillSource>;
  deleteSource: (id: string) => Promise<void>;
  refreshSource: (id: string) => Promise<void>;
  list: (sourceId: string, agentId?: string) => Promise<Skill[]>;
  install: (input: SkillInstallInput) => Promise<SkillRef[]>;
  uninstall: (input: SkillUninstallInput) => Promise<SkillRef[]>;
  listLocal: (agentId: string) => Promise<LocalSkill[]>;
  getState: (agentId: string) => Promise<SkillsState>;
  publish: (input: SkillPublishInput) => Promise<SkillPublishResult>;
}
