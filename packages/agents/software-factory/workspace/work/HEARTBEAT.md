# Heartbeat 

This is your work that you periodically need to do.

## Step 0 — Acquire work lock (mandatory, first action)

Call the `acquire_lock` tool on the `heartbeat-lock` MCP server. Parse the JSON in the response:

- If `acquired` is `false`, another heartbeat is already working — **stop immediately, do nothing else, exit your turn with no further actions**.
- If `acquired` is `true`, proceed with the rest of this document. The lock is refreshed automatically by hooks while you work, and released automatically when you stop.

Read `config.json` in workspace first, if not existing exit immediately.

## Step 0a — PRD lifecycle check (mandatory, before any work)

For the PRD recorded in `config.json`, inspect its labels:

- **PRD has label `done`** → the product loop for this PRD is finished. Call `mcp__platform-outbound__delete_schedule` to disable this heartbeat and exit. Do not file issues, do not re-decompose, do not look for new work.
- **PRD has no `prd:<n>`-labelled children at all** (query with `gh issue list --label "prd:<n>" --state all`) → the PRD has not yet been decomposed; invoke `/to-issues` for it once.
- **PRD has children but none with `working` or `needs review`** → evaluate "Done detection" below **before** picking new work. The heartbeat must never re-run `/to-issues` against a PRD that already has any `prd:<n>`-labelled issue (open *or* closed).

## Your Workflow

### Orchestrate Work First

Always query `gh issue list --state all` for PRD-derived issues — closed ones count for done-detection and for failure-handling lookups.

1. If a ticket already has label `working`, proceed to implementation phase.
2. Else if a ticket already has label `needs review`, proceed to code review phase.
3. Else if at least one open `prd:<n>` issue is unblocked, proceed to identification of next working ticket.
4. Else — no open work — evaluate "Done detection" below. **Do not create new issues.**

### Next Working Ticket Identification

Analyze the open issues and build a dependency graph. For each issue, determine whether it **blocks** or **is blocked by** any other open issue.

An issue B is **blocked by** issue A if:

- B requires code or infrastructure that A introduces
- B and A modify overlapping files or modules, making concurrent work likely to produce merge conflicts
- B's requirements depend on a decision or API shape that A will establish

An issue is **unblocked** if it has zero blocking dependencies on other open issues.

Based on the dependency graph move the most obvious ticket to working (add lable working) so that next heartbeat can pick this app straight in implementation phase.

Your work is done here.

### Implementation Phase

Your goal is to implement ticket with label `working`. Then you will be working only on that and nothing else, make sure you don't feature creep.

Work on the ticket and file PR with the result. **Always pass `--base main`** to `gh pr create` — never rely on the repo's current default-branch setting (it may be wrong; CLAUDE.md initialization verifies and fixes it, but be explicit anyway). Once PR is done, assign `needs review` label.

**Important** - Make sure you always follow `DEVELOPMENT_GUIDELINES.md`

Your work is done here.

### Review Phase

Look at the PR of the ticket and perform code review.

If you find improvements to make:

1. Make the changes directly
2. Commit with a concise message starting with `review:` describing the refinements

**Important** - Make sure you always follow `DEVELOPMENT_GUIDELINES.md`

If the code is already clean and well-structured, verify CI is green on the PR (`gh pr checks <PR>`) **before** merging — never merge with failing or pending required checks. Once checks pass, merge the PR, close the ticket, and **remove the `needs review` label from the ticket** (closing an issue does not clear labels) so the orchestration phase doesn't pick it up again.

After merging, evaluate "Done detection" below.

### Failure handling

When work for a scope fails (CI red, deploy not live, prior review rejected) **and a closed ticket already covers that scope**, re-open the closed ticket (`gh issue reopen <n>`) and add a comment describing the new failure mode. **Do not file a new issue** for scope that's already been tried.

For CI/CD work in particular, reserve the canonical label `area:ci` and require that at most **one** open `area:ci` issue exists at any time. If one already exists, comment on it; do not create a parallel one.

A simple precondition before creating any new issue: search closed issues for near-duplicate titles. If a closed issue covers the scope you're about to file, re-open it instead.

### Done detection

After closing a ticket, or whenever orchestration finds no `working` / `needs review` / unblocked open issue, evaluate:

- Are **all** `prd:<n>`-labelled issues closed (open count = 0)?
- Do the PRD's acceptance criteria pass? At minimum: CI green on `main`, and — for shippable PRDs — the deploy is live.

If both are true, label the PRD `done`, call `mcp__platform-outbound__delete_schedule` to disable this heartbeat, and exit. The product loop is complete. Do not file anything else.

### Idle-cycle safeguard

Track in `config.json` an `idleHeartbeats` counter: the number of consecutive heartbeats that produced **no merged PR and no label transition**. Reset to 0 whenever a PR merges or a ticket moves between `working` / `needs review` / closed. If `idleHeartbeats` reaches **5**, stop and surface a message to the user via the channel ("I think I'm done — is there more work?") rather than continuing to look for work. Do not invent new issues to "find something to do".
