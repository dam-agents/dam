/** An installed skill on an instance, keyed by source + name. Version is a commit SHA. */
export interface SkillRef {
  source: string;
  name: string;
  version: string;
  /** Deterministic SHA-256 of the skill directory's file contents at install
   *  time. Compared to the scanner's contentHash to flag drift. Optional for
   *  backward compatibility with installs that pre-date this field. */
  contentHash?: string;
}

/** A connected skill source (e.g. a public git repo). */
export interface SkillSource {
  id: string;
  name: string;
  gitUrl: string;
  /** True when the source is managed by the cluster admin (Helm-seeded). Users can't delete it. */
  system?: boolean;
  /** Present when the source was declared by an agent template (spec.skillSources).
   *  UI-only hint for the "Agent" badge — backend treats template sources as read-only. */
  fromTemplate?: {
    templateId: string;
    templateName: string;
  };
  /** True when the current user has a publish credential stored for this source. */
  canPublish?: boolean;
}

/** A skill available from a connected source. Version is the source's HEAD
 *  commit SHA; contentHash is a deterministic content signature used for
 *  drift detection (see SkillRef.contentHash). */
export interface Skill {
  source: string;
  name: string;
  description: string;
  version: string;
  contentHash: string;
}

export interface CreateSkillSourceInput {
  name: string;
  gitUrl: string;
}

export interface InstallSkillInput {
  instanceId: string;
  source: string;
  name: string;
  version: string;
  /** Content hash captured from the scan result. Optional because the MCP
   *  tool flow may install a skill without a prior scan (in which case the
   *  agent-runtime computes + returns it at install time). */
  contentHash?: string;
}

export interface UninstallSkillInput {
  instanceId: string;
  source: string;
  name: string;
}

/** A skill authored directly on the instance's PVC (not installed from a remote source). */
export interface LocalSkill {
  name: string;
  description: string;
  skillPath: string;
}

export interface PublishSkillInput {
  instanceId: string;
  sourceId: string;
  name: string;
  title?: string;
  body?: string;
}

export interface PublishSkillResult {
  prUrl: string;
  branch: string;
}

/**
 * Explicit record of a publish event. Written on a successful
 * `publishSkill` call into the Postgres `instance_skill_publishes`
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
  publishedAt: string;  // ISO 8601
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
  listSources: (instanceId?: string) => Promise<SkillSource[]>;
  getSource: (id: string) => Promise<SkillSource | null>;
  createSource: (input: CreateSkillSourceInput) => Promise<SkillSource>;
  deleteSource: (id: string) => Promise<void>;
  refreshSource: (id: string) => Promise<void>;
  listSkills: (sourceId: string, instanceId?: string) => Promise<Skill[]>;
  installSkill: (input: InstallSkillInput) => Promise<SkillRef[]>;
  uninstallSkill: (input: UninstallSkillInput) => Promise<SkillRef[]>;
  listLocal: (instanceId: string) => Promise<LocalSkill[]>;
  getState: (instanceId: string) => Promise<SkillsState>;
  publishSkill: (input: PublishSkillInput) => Promise<PublishSkillResult>;
}
