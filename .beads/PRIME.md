# Beads (bd) — issue tracking

`bd` owns issues for this repo. Its state lives in Dolt, not git, so `bd dolt push` is a separate
step from `git push`.

Task-list state and cross-session memory belong to the harness, not to bd.

## Finding and claiming

```bash
bd ready                  # issues with no blockers
bd list --status=open     # everything open
bd show <id>              # detail, including dependencies
bd update <id> --claim    # claim it
bd blocked                # what's stuck and why
bd search <query>         # keyword search
```

## Creating and closing

```bash
bd create --title="..." --description="..." --type=task|bug|feature|epic --priority=2
bd update <id> --title/--description/--notes/--design "..."
bd close <id> [<id>...] [--reason="..."]
bd dep add <issue> <depends-on>
```

`--priority` takes `0`-`4` or `P0`-`P4` (0 = critical, 4 = backlog). Words like "high" are rejected.

## Recorded knowledge

Roughly a dozen project gotchas are stored as bd memories (egress layering, buildkit worker choice,
lima clock skew, CRD description governance, experiments locking order, and others). They are not
loaded upfront. Search when a task touches one:

```bash
bd memories <keyword>
bd remember --key <key> "..."   # update in place
```

## Sync and health

```bash
bd dolt pull / bd dolt push
bd stats
bd doctor                       # sync problems, missing hooks
bd preflight                    # pre-PR: lint, stale, orphans
```

## Gotcha

`bd edit` opens `$EDITOR` and will hang a non-interactive session. Use `bd update` with inline
flags instead.
