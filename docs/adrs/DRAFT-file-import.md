# ADR-DRAFT: File import — bundled, recursive merge into the work dir

**Date:** 2026-05-13
**Status:** Proposed
**Owner:** @janjeliga

## Context

Local Claude Code users accumulate per-project context (`CLAUDE.md`, `.claude/`, custom skills) that has no path into a Platform agent's workspace. The May 18 demo wants the seamless local→cloud move; the same primitive is the foundation for a forthcoming `dam import` CLI.

## Decision

Imports are a **one-shot, bundled, per-file merge** owned by api-server (orchestration) and agent-runtime (disk landing).

- Clients build a single tar bundle (gzip optional) and submit it through one ownership-checked api-server route, which streams it to agent-runtime with no buffering.
- agent-runtime extracts to a staging directory on the per-instance PVC, then walks the staging tree into `<homeDir>/work`. For each entry: if both sides are directories, recurse; otherwise the bundle entry replaces whatever is at the destination path via POSIX `rename`. Unrelated existing files in `work/` are left alone.
- Imports always target `<homeDir>/work`. Platform-reserved paths (`.triggers/`, `.initialized`) live at `<homeDir>` root, so they are siblings of the import landing and cannot be reached by a bundle structurally.
- One import per instance at a time; concurrent imports are rejected.
- Both legs enforce hard bounds: the proxy caps total upload size, the pod aborts stalled and runaway uploads.

Imports leave no record outside the PVC — the files themselves are the state.

## Alternatives Considered

- **Per-file upload over the existing tRPC files surface.** Rejected: N round-trips per import, no natural unit for the operation.
- **Declarative file push (extending the pod-files SSE channel).** Rejected: that channel is for platform-managed config fragments, not opaque user content.
- **Replace mode (wholesale purge of the destination).** Rejected: every retry would lose unrelated work the user had already done in `work/`. Per-file merge keeps every retry idempotent and additive.
- **Preflight conflict UX (Replace / Merge / Cancel).** Rejected: with a single merge semantics, the choice has only one answer; the UI would be ceremony around an already-decided question.
- **Bidirectional sync.** Rejected: out of scope; the import is a migration, not a workspace-coupling primitive.
- **Postgres-backed import audit trail.** Rejected: the PVC is the source of truth; a row would drift from disk and add no operational signal.

## Consequences

- **Easier:** any client (browser, future CLI) speaks the same multipart contract; the UI's agent-creation flow and files-panel folder upload are two callers of one operation; no mode field, no preflight, no schema changes.
- **Harder:** the bundle format is the contract — extending it (symlinks, long paths beyond USTAR `prefix`+`name`, ACLs) means a versioned successor, not an inline change.
- **Open-eyed:** an import can swap files mid-session — the PVC was already an adversarial-input surface, this just adds another writer on the same plane.
- **Atomicity, scoped to the file:** per-entry `rename` is atomic; the bundle as a whole is not transactional. A crash mid-walk leaves some entries replaced and others not. Subsequent re-imports converge because the operation is idempotent in destination terms (same source → same destination). The boot sweeper reclaims orphaned `.import-staging-*` dirs.
