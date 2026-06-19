# scripts

Thin deterministic helpers so the agent spends tokens on synthesis, not
mechanical work. Bash for git, ESM `.mjs` for parsing. No build step, no LLM.
Each script is pure, exits nonzero on error, and prints machine-parseable output
on stdout (diagnostics go to stderr). Run them from the workspace root
(`$HOME/work`), where `wiki.config.json` and `sources/` live; the wiki content
they read and lint lives one level down in `wiki/`.

Throughout, `<name>` is a source's short name — the basename of its `org/repo`
(e.g. `repo` for `org/repo`) — which is also its clone directory under
`sources/`.

## fetch-source.sh `<org/repo> [ref]`

Idempotently clone (or update) a source repo into `sources/<name>` and print its
resolved HEAD sha. Uses a blobless partial clone (`--filter=blob:none`): the full
commit and tree history is present so delta diffs against any watermark work,
while file contents are fetched lazily when the agent actually reads them. `ref`
may be a branch, tag, or sha; omitted, it tracks the remote default branch. Auth
goes through `gh`.

```sh
scripts/fetch-source.sh anthropics/claude-code main
```

## changed-files.sh `<name> [since-sha]`

Print what changed in `sources/<name>` since a watermark, for delta ingest. With
a `since-sha`, emits `git diff --name-status <since-sha>..HEAD` (`A`/`M`/`D` +
path, tab-separated); empty output means no new commits (no-op). With no
`since-sha`, prints `FULL` to signal a first/full ingest.

```sh
scripts/changed-files.sh claude-code "$(scripts/watermark.mjs read claude-code)"
```

## watermark.mjs `read|bump <name> [sha]`

Read or update a source's ingest watermark in `wiki.config.json`. `read` prints
the stored `watermark_sha` (empty if unset). `bump <name> <sha>` sets
`watermark_sha` and stamps `last_ingested` (today, `YYYY-MM-DD`), writing
atomically (temp file + rename). The source must already exist in
`wiki.config.json` (onboarding owns the source list); an unknown or ambiguous
name is an error.

```sh
scripts/watermark.mjs bump claude-code "$INGESTED_SHA"
```

## check-links.mjs

Scan `wiki/` for link health and print JSON for the `lint` skill to act on:

```json
{ "orphans": ["wiki/pages/..."], "brokenLinks": [{ "from": "...", "target": "wiki/pages/..." }] }
```

- **orphans** — pages under `wiki/pages/` that no inline markdown link (from
  `wiki/index.md` or any other page) points to.
- **brokenLinks** — inline markdown links to a `.md` file under `wiki/pages/`
  whose target does not exist on disk. External links, anchors, and non-`.md`
  targets (including `file:line @sha` citations) are ignored.
