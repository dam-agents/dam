import { z } from "zod";

/** A repo-relative subdirectory to scan for skills: relative, no `..`
 *  traversal, surrounding slashes trimmed so `/foo/` and `foo` are equal. */
export const skillSourcePathSchema = z
  .string()
  .transform((p) => p.trim().replace(/^\/+|\/+$/g, ""))
  .refine((p) => !p.split("/").includes(".."), "path must not contain '..'");

// --- Entity / output schemas ---

/** A connected skill source (e.g. a public git repo). */
export const skillSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  gitUrl: z.string(),
  path: z.string().optional(),
  /** True when the source is managed by the cluster admin
   *  (Helm-seeded). Users can't delete it. */
  system: z.boolean().optional(),
  /** Present when the source was declared by an agent template
   *  (spec.skillSources). UI-only hint for the "Agent" badge —
   *  backend treats template sources as read-only. */
  fromTemplate: z
    .object({ templateId: z.string(), templateName: z.string() })
    .optional(),
  canPublish: z.boolean().optional(),
});

export const skillPublishResultSchema = z.object({
  prUrl: z.string().url(),
  branch: z.string(),
});

/** A skill available from a connected source. Version is the source's
 *  HEAD commit SHA; contentHash is a deterministic content signature
 *  used for drift detection (see skillRefSchema.contentHash). */
export const skillSchema = z.object({
  source: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.string(),
  contentHash: z.string(),
});

/** An installed skill on an instance, keyed by source + name. Version
 *  is a commit SHA. */
export const skillRefSchema = z.object({
  source: z.string(),
  name: z.string(),
  version: z.string(),
  /** Deterministic SHA-256 of the skill directory's file contents at
   *  install time. Compared to the scanner's contentHash to flag drift.
   *  Optional for backward compatibility with installs that pre-date
   *  this field. */
  contentHash: z.string().optional(),
  /** Source subdir the skill was installed from, denormalized so the apply
   *  path resolves the skill dir without re-reading the source. */
  path: z.string().optional(),
});

/** A skill authored directly on the instance's PVC (not installed
 *  from a remote source). */
export const localSkillSchema = z.object({
  name: z.string(),
  description: z.string(),
  skillPath: z.string(),
  /** Provenance vs. the image's pristine copy: shipped untouched, shipped
   *  but diverged, or created at runtime. Absent on pre-provenance pods —
   *  treat as `user`. */
  origin: z.enum(["system", "system-modified", "user"]).optional(),
  /** Deterministic SHA-256 of the skill directory, comparable with a scanned
   *  skill's `contentHash`. Present only for skills the server asked the pod to
   *  hash, and absent on pods predating this field (#3019). */
  contentHash: z.string().optional(),
});

/** Explicit record of a publish event. Written on a successful
 *  `publish` call into the Postgres `agent_skill_publishes` table.
 *  The record's existence drives the badge's *presence* + "View PR"
 *  link in the UI — it replaced a name-match heuristic that had
 *  confusing false positives when a local skill happened to share a
 *  name with a catalog entry. `prState` drives the badge's *label*.
 *
 *  Source fields are denormalized so the record stays usable after
 *  the source is renamed or deleted. */
export const skillPublishRecordSchema = z.object({
  skillName: z.string(),
  sourceId: z.string(),
  sourceName: z.string(),
  sourceGitUrl: z.string(),
  prUrl: z.string(),
  /** ISO 8601 timestamp. */
  publishedAt: z.string(),
  /** Resolved outcome of `prUrl`, or null when it has never been
   *  resolved — the source is private, the read was rate-limited, the
   *  pull request is gone. `merged` and `closed` are terminal and are
   *  never re-read (#3019). */
  prState: z.enum(["draft", "open", "merged", "closed"]).nullable(),
  /** ISO 8601 timestamp of the last resolution *attempt*, which is not
   *  the same as the last success: an attempt that resolved nothing
   *  still stamps it, because it doubles as the backoff clock. Null
   *  until the first attempt. */
  prStateCheckedAt: z.string().nullable(),
});

/** Reconciled view of an instance's skills: both the installed
 *  (tracked in Postgres `agent_skills` AND present on disk) and
 *  the standalone (on disk but not tracked). Computing this in one
 *  pass lets the server drop ghost SkillRefs — entries whose
 *  directories were deleted out-of-band — and persist the cleanup so
 *  the declarative state stops drifting from the filesystem.
 *
 *  `instancePublishes` carries the publish history for this instance
 *  so the UI can badge exactly the skills the user actually pushed —
 *  each record's resolved `prState` decides what the badge says
 *  (draft / in review / published / closed, or merely "submitted"
 *  while unresolved). */
export const skillStateOutputSchema = z.object({
  installed: z.array(skillRefSchema),
  standalone: z.array(localSkillSchema),
  instancePublishes: z.array(skillPublishRecordSchema),
});

// --- Input schemas ---

export const skillListSourcesInputSchema = z
  .object({ agentId: z.string().min(1).optional() })
  .optional();

export const skillCreateSourceInputSchema = z.object({
  name: z.string().min(1).max(128),
  gitUrl: z.string().url(),
  path: skillSourcePathSchema.optional(),
});

export const skillDeleteSourceInputSchema = z.object({
  id: z.string().min(1),
});

export const skillRefreshSourceInputSchema = z.object({
  id: z.string().min(1),
});

export const skillListInputSchema = z.object({
  sourceId: z.string().min(1),
  agentId: z.string().min(1).optional(),
});

/** Read one skill's `SKILL.md` from its source, keyed by source + name.
 *  `agentId` targets the pod for private sources (public scan needs none). */
export const skillGetContentInputSchema = z.object({
  sourceId: z.string().min(1),
  name: z.string().min(1),
  agentId: z.string().min(1).optional(),
});

/** Raw `SKILL.md` text (frontmatter + markdown body); the UI renders it. */
export const skillContentSchema = z.object({
  content: z.string(),
  /** Source-relative directory the SKILL.md was found in, when resolvable —
   *  lets the UI build an accurate blob link instead of guessing the dir from
   *  the (frontmatter) skill name. */
  dir: z.string().optional(),
});

export const skillInstallInputSchema = z.object({
  agentId: z.string().min(1),
  source: z.string().url(),
  name: z.string().min(1),
  version: z.string().min(1),
  contentHash: z.string().optional(),
});

export const skillUninstallInputSchema = z.object({
  agentId: z.string().min(1),
  source: z.string().url(),
  name: z.string().min(1),
});

export const skillListLocalInputSchema = z.object({
  agentId: z.string().min(1),
});

export const skillStateInputSchema = z.object({
  agentId: z.string().min(1),
});

/** Remove a standalone Local Skill's directory from every Skill Path on the
 *  pod. `name` is what `state`/`listLocal` reported, which is the frontmatter
 *  display name — the pod resolves it to a directory. */
export const skillDeleteLocalInputSchema = z.object({
  agentId: z.string().min(1),
  name: z.string().min(1),
});

export const skillReadLocalInputSchema = z.object({
  agentId: z.string().min(1),
  name: z.string().min(1),
});

/** Every file in a Local Skill's directory, plus the resolved directory
 *  basename so the browser names the download from the on-disk identity. Caps
 *  are enforced pod-side; `base64` marks a file whose content is binary. */
export const skillLocalFilesSchema = z.object({
  dir: z.string(),
  files: z.array(
    z.object({
      relPath: z.string(),
      content: z.string(),
      base64: z.literal(true).optional(),
    }),
  ),
});

export const skillPublishInputSchema = z.object({
  agentId: z.string().min(1),
  sourceId: z.string().min(1),
  name: z.string().min(1),
  title: z.string().optional(),
  body: z.string().optional(),
});

/** Create standalone Local Skills from uploaded Markdown — one skill per file.
 *  Caps mirror agent-runtime's MAX_FILE_BYTES/MAX_SKILL_BYTES as a cheap early
 *  gate (character count, not bytes); agent-runtime stays the authoritative
 *  byte-accurate enforcement. */
export const skillCreateLocalInputSchema = z
  .object({
    agentId: z.string().min(1),
    skills: z
      .array(
        z.object({
          name: z.string().min(1).max(128),
          content: z.string().max(2 * 1024 * 1024),
        }),
      )
      .min(1)
      .max(50),
  })
  .refine(
    (v) =>
      v.skills.reduce((n, s) => n + s.content.length, 0) <= 5 * 1024 * 1024,
    "batch exceeds 5 MB",
  );
