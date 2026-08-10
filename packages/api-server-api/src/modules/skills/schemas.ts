import { z } from "zod";

import { resourceNameSchema } from "../connections/schemas.js";

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
  /** Repo-relative directory the skill was found in, whichever Source Root it
   *  came from — what a raw-file URL needs. Distinct from `skillSourceSchema.path`,
   *  which is the source's optional subdir; `dir` is this one skill's actual
   *  location under it. Optional: the agent-runtime clone scan (private /
   *  non-GitHub sources) doesn't report it. */
  dir: z.string().optional(),
});

/** A source's scanned skill list plus when that scan was read from upstream. */
export const skillListResultSchema = z.object({
  skills: z.array(skillSchema),
  /** ISO 8601 time the source's skill list was last read from upstream. A
   *  cache hit reports the original read, not the moment of the hit. */
  scannedAt: z.string().datetime(),
});

/** Why a source's scan failed, in the user's language. Carried structurally on
 *  the tRPC error (`data.scanFailure`) rather than inside its message, so a
 *  client can tell a verdict the server actually reached from a transport
 *  failure that never got there — the latter arrives with no `scanFailure` at
 *  all and must never be rendered verbatim.
 *
 *  `other` means "classified, but not one of the named causes"; it still
 *  carries copy the user can act on. The internal error stays server-side. */
export const scanFailureCodes = [
  "needs_github_connection",
  "needs_sandbox",
  "repo_unreachable",
  "agent_unreachable",
  "other",
] as const;

export const scanFailureSchema = z.object({
  code: z.enum(scanFailureCodes),
  /** Single line naming the cause. */
  title: z.string(),
  /** Single line naming the fix. */
  detail: z.string(),
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
  /** Present only when `standalone` came from a recorded snapshot rather than a
   *  live pod read — the sandbox is stopped. Absent while running, which is what
   *  lets a reader tell live truth from a snapshot without a second field for
   *  the running case. */
  standaloneSnapshot: z
    .object({ capturedAt: z.string().datetime() })
    .optional(),
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

/** One skill inside a set. `source` is the source's **git URL**, not its id —
 *  the same identity `agent_skills` installs on, so a set survives its source
 *  row being deleted and re-added, and two sources carrying an `xlsx` stay
 *  distinguishable. */
export const skillSetEntrySchema = z.object({
  source: z.string().url(),
  name: z.string().min(1),
});

/** Same rule as every other user-named resource, from the one shared
 *  definition — so client and server can't drift on what is legal — with a
 *  skill-set example rather than a Connection's. */
export const skillSetNameSchema = resourceNameSchema("my-skill-set");

export const skillSetSchema = z.object({
  id: z.string(),
  name: z.string(),
  skills: z.array(skillSetEntrySchema),
  createdAt: z.string(),
});

export const skillSetCreateInputSchema = z.object({
  name: skillSetNameSchema,
  skills: z.array(skillSetEntrySchema).min(1).max(500),
});

export const skillSetDeleteInputSchema = z.object({ id: z.string().min(1) });

export const skillSetApplyInputSchema = z.object({
  agentId: z.string().min(1),
  setIds: z.array(z.string().min(1)).min(1).max(50),
});

/** Why an entry could not be applied. A closed set of verdicts rather than a
 *  message: the client renders its own copy, so a server-authored sentence
 *  would be a string the UI has to trust. Mirrors how `ScanFailure` carries a
 *  code instead of prose. */
export const skillSetSkipReasonSchema = z.enum([
  "source-not-connected",
  /** The source is connected here but could not be read — a credential or
   *  transport problem. Distinct from the two above because the fix differs:
   *  connect the source, make it readable, or accept the skill is gone. */
  "source-unreadable",
  "not-in-source",
]);

export const skillSetApplyResultSchema = z.object({
  /** Full installed list after the apply — authoritative, like every other
   *  install path's return. */
  installed: z.array(skillRefSchema),
  skipped: z.array(
    skillSetEntrySchema.extend({ reason: skillSetSkipReasonSchema }),
  ),
});

/** Many installs and uninstalls applied under a single outbox bump, so a bulk
 *  action costs one apply cycle instead of one per skill. The caps bound the
 *  work a single call can ask for; a real source sits far below them. */
export const skillApplyBatchInputSchema = z.object({
  agentId: z.string().min(1),
  install: z
    .array(
      z.object({
        source: z.string().url(),
        name: z.string().min(1),
        version: z.string().min(1),
        contentHash: z.string().optional(),
      }),
    )
    .max(500)
    .default([]),
  uninstall: z
    .array(
      z.object({
        source: z.string().url(),
        name: z.string().min(1),
      }),
    )
    .max(500)
    .default([]),
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
