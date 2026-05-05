# Google Workspace Agent — Roadmap

## Planned Enhancements

### ~~Claude Code Skills~~ (Done)

~~Replace the flat `workspace/work/CLAUDE.md` with structured Claude Code skills (`.claude/skills/`).~~ Shipped: `drive-upload`, `drive-manage`, `gmail-triage`, `calendar-agenda`, `sheets-data`.

### ~~Automatic OAuth Token Refresh~~ (Done)

~~A future enhancement could proactively refresh tokens before expiry to avoid transient 401s.~~ Shipped: the api-server runs an OAuth refresh loop that re-mints access tokens before they expire (see `oauth-refresh-service.ts`).
