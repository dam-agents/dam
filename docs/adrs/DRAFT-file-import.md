# ADR-DRAFT: File import — bundled, atomic, one-shot

**Date:** 2026-05-07
**Status:** Proposed
**Owner:** @janjeliga

## Context

Local Claude Code users accumulate per-project context (`CLAUDE.md`, `.claude/`, custom skills) that has no path into a Platform agent's `/home/agent`. The May 18 demo wants the seamless local→cloud move; the same primitive is the foundation for a forthcoming `dam import` CLI.

## Decision

Imports are a **one-shot, bundled, atomic** operation owned by api-server (orchestration) and agent-runtime (disk landing).

- Clients build a single `tar.gz` and submit it through one ownership-checked api-server route, which streams it to agent-runtime with no buffering.
- agent-runtime extracts to a staging directory on the per-instance PVC, then swaps it into `/home/agent` under the chosen `mode` (`replace` or `merge`) with per-entry interleaved `rm`+`rename` so the crash window is a single top-level entry, not the whole bundle.
- A companion preflight call returns top-level conflicts so clients can drive an OS-style Replace/Merge/Cancel UX without uploading first.
- One import per instance at a time; concurrent imports are rejected.

Imports leave no record outside the PVC — the files themselves are the state.

## Alternatives Considered

- **Per-file upload over the existing tRPC files surface.** Rejected: no atomicity, N round-trips per import, no natural unit for the operation.
- **Declarative file push (extending the pod-files SSE channel).** Rejected: that channel is for platform-managed config fragments, not opaque user content.
- **Bidirectional sync.** Rejected: out of scope; the import is a migration, not a workspace-coupling primitive.
- **Postgres-backed import audit trail.** Rejected: the PVC is the source of truth; a row would drift from disk and add no operational signal.

## Consequences

- **Easier:** any client (browser, future CLI) speaks the same multipart contract; the UI's agent-creation flow and files-panel folder upload are two callers of one operation; no schema changes.
- **Harder:** the bundle format is the contract — extending it (symlinks, long paths beyond USTAR `prefix`+`name`, ACLs) means a versioned successor, not an inline change.
- **Open-eyed:** an import can swap files mid-session — the PVC was already an adversarial-input surface, this just adds another writer on the same plane.
- **Atomicity, scoped:** the swap is not a single atomic transaction (Node doesn't expose `renameat2(RENAME_EXCHANGE)`). `replace` mode interleaves `rm`+`rename` per top-level entry so a crash mid-loop loses at most one top-level path's data, not all of them; `merge` mode is bounded by per-file `rename`, which IS atomic for the individual file. The boot sweeper reclaims orphaned `.import-staging-*` dirs.
