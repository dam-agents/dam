You are an agent that should help building production quality software.

When instructed to do heartbeat. Read [Heartbeat](./HEARTBEAT.md) immediately, follow-up there and **skip everything here**.

## User-initiated resume

If you are in an interactive session (not a scheduled heartbeat) and the user tells you to continue / resume / unpause while the PRD currently carries the `paused` label, treat that as explicit permission:

1. Acknowledge the user. If they included guidance about what was stuck (e.g. "I fixed the GitHub Actions secret"), note it.
2. Call `/pause-and-notify` in resume mode — it will remove the `paused` label, clear `stuckCounters`, post a brief resume note to the channel, and comment on the PRD.
3. The next scheduled heartbeat (or your current session, if the user is asking you to keep working) proceeds normally.

Do **not** silently remove the `paused` label without a user request. The label is the user's signal that the heartbeat has stopped; only the user (or the user proxying through you in a session) may clear it.

## Checks

This project requires Github integrations, always ensure that github is connected. Use whoami in `gh` to check whether user is logged in and rejected anything unless not connected. Ask politely for connection first.

## Initialization

The project has to be initialized. You need to read `config.json` in workspace. If it doesn't exist ask user for configuration.

- You will need github repository where the system operates.
- Verify the repository's **default branch** is `main` (or, if the project is configured for a different long-lived trunk, confirm that's what the user wants). Run `gh repo view --json defaultBranchRef`; if the default points at a feature branch, fix it with `gh repo edit --default-branch main` before continuing. Every PR you ever file uses this branch as its base — getting it wrong silently routes work into a stale branch.

Once gathered all data store to `config.json`

Make sure the repository has existing labels created:

- `PRD` — labels PRD tickets
- `prd:<n>` — links a decomposed ticket back to its parent PRD (`<n>` is the PRD issue number). Every issue created by `/to-issues` must carry this label.
- `working` — tickets that are actively being worked on
- `needs review` — active working is done, to be reviewed before merge
- `done` — PRD has been fully delivered; the heartbeat must exit and disable its schedule when it sets this label
- `paused` — applied to the PRD when the heartbeat suspends itself after repeated failures. The user removes this label to resume work. See `/pause-and-notify` and the "Stuck detection" section of HEARTBEAT.md.
- `area:ci` — reserved canonical label for CI/CD work; at most one open `area:ci` issue may exist at a time

### `config.json` shape

Persist at least these fields so the heartbeat survives pod restarts:

```json
{
  "github": { "repo": "<owner/repo>", "prd": <prd-issue-number> },
  "stuckThresholds": {
    "failuresPerWorkUnit": 3,
    "ciRedConsecutive": 3,
    "idleHeartbeats": 5
  },
  "stuckCounters": {},
  "lastTurn": null,
  "idleHeartbeats": 0
}
```

`stuckThresholds` is the only operator-tunable block — if it's missing on read, fall back to the defaults shown above. All other fields are maintained by the heartbeat itself.


### Create PRD (Product Requirement Document) and issues

Knowing what repo you operate in as the next step is to know what we are building and that's available in PRD.

Understand [Development Guidelines](./DEVELOPMENT_GUIDELINES.md) first.

Look at the Github whether PRD exists. If not start /grill-me session to understand product requirements. Upon grill session is finished let's /to-prd to create PRD in github with proper label.

Once PRD is specified initiate /to-issues — but **first check whether the PRD has already been decomposed**. Query `gh issue list --label "prd:<PRD-number>" --state all`. If any issue exists (open *or* closed), the PRD is already decomposed — do **not** run `/to-issues` again. Either resume the existing breakdown or evaluate done-detection (see HEARTBEAT.md). 

Having the tickets and PRD specified, your next goal is to setup heartbeat. You can easily achieve that via `mcp__platform-outbound__create_schedule` just make sure you setup Heartbeat schedule that is awaking the agent every minute to do the heartbeat.

Your work ends here as all the engineering work will happen in heartbeats.