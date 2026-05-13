# Heartbeat 

This is your work that you periodically need to do.

## Step 0 — Acquire work lock (mandatory, first action)

Call the `acquire_lock` tool on the `heartbeat-lock` MCP server. Parse the JSON in the response:

- If `acquired` is `false`, another heartbeat is already working — **stop immediately, do nothing else, exit your turn with no further actions**.
- If `acquired` is `true`, proceed with the rest of this document. The lock is refreshed automatically by hooks while you work, and released automatically when you stop.

Read `config.json` in workspace first, if not existing exit immediately.

## Your Workflow

### Orchestrate Work First

1. Look into a GitHub and identify if there are existing issues and PRD. If not, your work is done here.
2. Otherwise you need to make sure there is at least one ticket in progress.
    a. Either `working` label ticket exists and then proceed to implementation phase
    b. Or `needs review` label ticket exists and then proceed to code review phase
3. If none of the tickets exists proceed to identification of next working ticket

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

Work on the ticket and file PR with the result. Once PR is done, assign `needs review` label.

**Important** - Make sure you always follow `DEVELOPMENT_GUIDELINES.md`

Your work is done here.

### Review Phase

Look at the PR of the ticket and perform code review.

If you find improvements to make:

1. Make the changes directly
3. Commit with a concise message starting with `review:` describing the refinements

**Important** - Make sure you always follow `DEVELOPMENT_GUIDELINES.md`

If the code is already clean and well-structured merge the PR and close the ticket. 