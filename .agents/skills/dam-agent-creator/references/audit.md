# The weekly audit run

Every generated agent gets one — a shared agent runs unattended, and without a scheduled
self-check, silent failure modes (a dead schedule, drifted state, a stuck pipeline, an
expired token) stay invisible until someone notices work not happening. For reactive and
on-demand agents the audit is typically the **only** scheduled run.

Default cadence: weekly (e.g. Friday morning), gated by a config key
(`audit_report: enabled` default). The audit is **read-only toward external systems and
repair-free**: it reports findings; routine ones heal on the next run of their pipeline,
everything else goes to the operator. Its only local write beyond its own log line is the
memory consolidation (when the agent has memory).

## Division of labor

- **Deterministic checks** → the pre-flight's `audit` mode (when the agent has a
  pre-flight; otherwise the agent runs the same checks manually from a checklist in
  `docs/audit.md`). Facts a script can compute: connectivity, log scans, state
  consistency, disk, version drift.
- **Judgment checks** → the agent: things that need MCP tools (schedule existence),
  sampling posted output against rules, interpreting trends.

Design rule: a skipped check is an incomplete audit — impossible-this-week checks are
reported as `warn` with the reason, never dropped silently.

## Universal check catalogue

Include what applies; add domain checks from the design's effects list.

**Deterministic (script side):**

- Auth/connectivity to each integration (an unauthenticated GET; plus rate-limit headroom
  where the API reports it).
- State-repo push backlog (local commits not on the remote when git-backed state).
- Run cadence: gaps in each run type's log vs. its schedule (missed runs).
- Error scan: `ERROR:`-prefixed lines across the week's logs.
- State consistency: tracking rows vs. external markers (sampled cross-verification both
  directions — rows without markers, markers without rows).
- Stale locks, duplicate tracking rows, prune backlog, orphaned per-item files, orphaned
  published artifacts, leftover temp directories.
- Disk usage of the volume; cache freshness.
- Definition cleanliness (`git -C "$HOME" status --porcelain` empty) and version currency
  (checked-out vs. latest vs. adopted `work/VERSION` — drift is a warn; the audit never
  updates, only reports — acting on versions happens in the direct session).

**Judgment (agent side):**

- Every designed schedule exists and is enabled (`mcp__platform-outbound__list_schedules`)
  with the cron ONBOARDING registered — a dead schedule is invisible to every other check;
  the log-gap check catches the past, this catches the future.
- Sample this week's outputs (~3): required markers present, formats honored, memory
  rules/overrides respected, gates (labels, opt-ins) actually gated.
- Channel-facing agents: claimed-but-unsent messages (write-before-send means state may
  claim a send that failed — cross-check state vs. send-failure log lines), effectiveness
  ratios, items stuck at the escalation ceiling.
- Trends: throughput vs. last week, outcome distribution extremes (100% one verdict =
  suspicious), backlog age, idle-run ratio (a falling ratio is a rising bill).
- Config validity: required keys present and parseable; roster integrity when one exists.

## Report format

One message, traffic-light, counts and one-liners over prose:

```
🩺 *<display name> weekly audit* — <date> · 🟢 N ok · 🟡 N warn · 🔴 N fail

*Week in numbers* (since <ISO>)
• <domain throughput counters> · <backlog> · <idle ratio>
• Memory: merged X · promoted Y · dropped Z        (only with memory)

*Checks*
🔴 <id> — <detail>          ← every fail, never summarized away
🟡 <id> — <detail>
🟢 all other checks passed (<count>)

*Action needed*: <one line per item needing a human, or "none">
```

Delivery: the configured channel when channel notifications are enabled (a send failure
is itself a finding → full report to the chat UI); the chat UI always. Then append one
line to `work/AUDIT.log` — `<ISO> ok=<n> warn=<n> red=<n> sent=<channel|chat>` — avoiding
the substrings the error scan greps for, and persist `work/`.

## Memory consolidation (only when the agent has memory)

The audit's one write beyond its log: merge duplicate learned entries, promote the
repeatedly-confirmed into rules, compress-or-drop the stale, enforce the size bounds,
never touch operator-tagged entries. Report the delta as one line. This is what keeps
memory useful and bounded forever.
