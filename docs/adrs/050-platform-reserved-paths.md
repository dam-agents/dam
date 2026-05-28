# ADR-050: Platform-reserved paths

**Date:** 2026-05-21
**Status:** Accepted
**Owner:** @tomkis

## Context

The agent-runtime file API has always exposed a single EXCLUDE set that hid `.triggers/`, `.initialized`, `.git/`, `node_modules/`, `.npm/`, `.DS_Store`, and `.claude.json` from both listing and writes. The set was introduced alongside the trigger-files mechanism in the same commit that created `.triggers/` ([ADR-008](008-trigger-files.md), [DRAFT-file-import](044-file-import.md)), with no ADR. Two distinct concerns were bundled: a correctness invariant the controller relies on, and opportunistic noise filtering bolted on to keep the full-tree poll cheap. Lazy fetch ([ADR-049](049-lazy-workspace-fetch.md)) removes the payload-control argument for noise filtering, surfacing the conflation.

## Decision

The platform reserves a small, explicit set of paths under the agent's working directory — currently `.triggers/` and `.initialized` — that the file API must never list and never write. These paths are the controller's communication channel into the pod; user edits would break agent lifecycle. The reservation is enforced server-side in the agent-runtime, symmetrically for read and write.

All other paths are surfaceable. Previously noise-filtered entries (`.git/`, `node_modules/`, `.npm/`, `.DS_Store`, `.claude.json`) become both listable and writable. Default-collapsed UI behavior keeps them out of the user's way without server-side hiding.

## Alternatives Considered

- **Keep the original EXCLUDE set intact** — conflates correctness and UX; future readers cannot distinguish "must be hidden" from "we just didn't want it in the panel".
- **Block writes inside noise paths but allow reads** — asymmetric and arbitrary; if the user can see `.git/HEAD` they can reasonably expect to be able to fix it.
- **Move the reservation list to runtime config** — premature flexibility; the reservation is a property of the platform's coupling to the controller, not a deployment decision.

## Consequences

- **Easier:** The invariant the trigger-files mechanism relies on is documented and testable in one place; an audit of "what does the controller assume is inert?" returns a concrete answer.
- **Easier:** Users can inspect and repair their own `.git/` state, edit a stray `.DS_Store`, or peek inside `node_modules/` for debugging without leaving the panel.
- **Harder:** A user can now write garbage into `.git/HEAD` and break their checkout; the panel offers no warning beyond the path itself being visible. This is the cost of symmetric access.
- **Committed-to:** The reservation list is part of the platform contract between the controller and the agent-runtime. Adding a new reserved path is a breaking change against any user content that already exists at that path.
