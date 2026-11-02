# The quality benchmark (optional)

For an agent whose output quality is a judgment call (reviews, classifications, summaries, triage), the audit says the agent runs, not that it runs **well**.
The benchmark answers "did the model upgrade, the new definition version or the new skill help?": it replays a fixed set of synthetic work items through the full production pipeline, scores the output against ground truth seeded into those items, and records wall-clock time and tokens per item.
Results accumulate forever, so any two runs are comparable across model upgrades and definition releases.

Propose it only where the operator would act on the numbers: it costs real tokens every run, the complex tier the most.
It is off by default, behind its own config key, and writes nothing to the production domain beyond its own report.

The generated agent gets one procedure doc, `docs/benchmark.md`, holding everything below in the agent's own terms (its unit of work, its output format, its matcher), plus the scripts in **Scripts**.

## What it measures

The production configuration **as one unit**: the session model (`run_model`), the adopted definition version, the configured skills and the agent's memory files.
A run never swaps one of them for the test's sake, except the model the operator names for an on-demand run.

## Layout (`work/benchmark/`)

```
fixture/<slug>/          # one synthetic work item, immutable once created
  <inputs>               # what a production run would read for this item (trees, documents, messages)
  <inputs-v2>            # with a follow-up phase: the item after a change
  manifest.json          # ground truth — the ONLY place it lives
  prior-output.md        # with a follow-up phase: the canonical earlier output
  item.json              # simulated item metadata (id, title, author, versions)
fixture/retired/<slug>/  # retired fixtures, kept forever (past results reference them)
results/<ts>.json        # one scored run over all fixtures (ts = YYYYMMDDTHHMMSSZ, UTC)
results/raw/<ts>-<slug>-<phase>.md
.run-lock                # one scored run at a time
.run-notes-<ts>.md       # segmented-run ledger; absent otherwise
judge.json               # the judge the agent pinned under benchmark_judge: auto
RESULTS.md               # append-only index, one row per run × fixture
report.html              # the accumulated report, regenerated every run
trials/<id>/             # one trial's lock, results and report
```

`results/`, `results/raw/` and `RESULTS.md` are **append-only**: runs add files and rows, existing ones stay untouched forever.
A fixture is immutable after creation; one that stops representing the target gets a new sibling slug beside it.

## Phases

A phase is one pipeline step the agent runs on an item in production, replayed the same way.

- **`first`** — the agent processes the item for the first time.
- **Follow-up** (only when the agent re-processes an item on change, interview block 2) — the item moves to its v2 state and the agent answers it with only the prior output in hand, as in production.
  It scores what a single pass can't: fixed items recognized as fixed, kept items still reported, new ones found, and the two going-in-circles signals, `false_fixed` (a present item reported fixed) and `churn` (the output flags the very change the prior output asked for).

## Task tiers and difficulty

The report must say "good enough for simple work, not for complex", so difficulty lives on two axes, both in `manifest.json` only:

- **Task tier** — each fixture's `tier`: `simple` (absent = simple) or `complex`.
  The set holds a minimum per tier (CG default: **≥ 5 simple and ≥ 3 complex**).
  Define both sizes for the domain at design time: a simple fixture is a small, single-concern item with ~10–14 seeded items, 2–3 of them hard; a complex one spans several parts with ~15–20 seeded items, ≥ 5 hard, and its v2 changes interact (one fix moves the precondition of another item).
- **Item difficulty** — `"difficulty": "hard"` on a seeded item that needs reasoning across parts or steps (a lock released on one path only, an invariant broken two calls away, a unit mismatch between producer and consumer), never a surface pattern.
  Every other item is easy.

The slug names the shape of the item, never its tier: the replaying session sees the slug.

## Trust invariants

Write each one into `docs/benchmark.md` and give it a deterministic home (SKILL.md → Non-negotiables → Rules are enforced):

- **Ground truth lives in `manifest.json` and nowhere else.** Every other fixture file is an input of the replay, so a seeded item must look like an ordinary mistake there: no item ids (`D01`, `BUG-2`), no comment naming a planted flaw, no "seeded"/"intentional"/"bait"/"false positive" words, nothing in the v2 inputs announcing the delta (`FIXED`, `still present`).
  The fixture validator enforces it.
- **Creation and scored runs never share a session.** The creating session knows the answers, so it ends after creating the set; the next benchmark tick (or an operator-asked run in a fresh session) scores it.
- **The replay never reads ground truth.** `manifest.json`, `RESULTS.md` and past `results/` are read only in the scoring phase, after every raw output is written.
  The replay's inputs are exactly the fixture inputs plus the files a production run reads (its procedure docs, memory files).
- **One scored run at a time**, behind a lock.
- **Results are validated before they enter the history**: a drifted shape still renders, the numbers are simply wrong forever.
- **Measurements come from a script, never by hand**: a duration derived from file mtimes looks identical to a measured one and is not comparable.
- **The judge stays beside the deterministic metrics, never inside them**: the quality index comes from scorer output only.
- **Nothing in the production domain is touched**: no post, message or field write; the work repo that backs up `work/` (which now holds ground truth) is never public.

## Creating the fixture set

Triggered by the pre-flight's `create_fixture` action (set incomplete) or the operator.
The entry carries `existing` (slugs on disk), the minimum per tier and `missing` (`{simple, complex}`): create the missing fixtures only.

1. **Choose the shapes.** Read the target's characteristics (languages, document types, ticket categories) and the configured skills.
   Cover at least as many clearly different shapes of item as the simple minimum, so that every skill trigger receives ≥ 1 input from ≥ 1 fixture.
   Name each slug after its shape (`ts-api`, `billing-ticket`, `release-notes`).
   A complex fixture is a larger item of one of these shapes and sets `"tier": "complex"`.
2. **Generate each fixture** to its tier's size:
   - The clean starting state, then the v1 state with the tier's count of seeded items spread across the domain's classes and severities, plus a few clean-but-suspicious-looking parts, unlabelled: they measure false positives.
   - With a follow-up phase, the v2 state: roughly half the seeded items fixed, the rest kept, and 3–5 new ones.
   - Keep seeded items far enough apart that the matcher's windows never overlap (CG: ≥ 10 lines apart for a ±3-line window), and make each a **distinct pattern**, so an output that merges same-class occurrences does not swallow two items.
   - Mark the tier's count of items `"difficulty": "hard"`.
3. **Write `manifest.json`**, verifying every location against the actual inputs.
4. **Write `prior-output.md`** (follow-up phase only) in the agent's real output format, carrying ~70 % of the v1 items; set `in_prior_output: true` on exactly those.
5. **Write `item.json`**: synthetic, stable ids and version hashes (e.g. `git hash-object --stdin` over a fixture-unique string per version).
6. **Derive any diffs or derived inputs** with the same commands the replay uses, so paths and anchors match the manifest.
7. **Validate the set before it is accepted** — `benchmark-validate.sh fixture <fixture-dir>…`.
   A fixture that fails is not a fixture: fix it in this session and re-run until it passes.
8. Report each fixture's table (tier; id, location, class, severity, difficulty, fixed in v2, in prior output) and the validator's `PASS` line, log `benchmark fixtures created (<k> new, set now <n>, validated)`, back up `work/` and **end the session**.
   The report invites an on-demand run in a fresh session when the operator wants a baseline before the next scheduled tick.

**Saturation**: a fixture scoring `f1 = 1.0` in two consecutive runs of the same model and effort has saturated; add a harder sibling slug and keep the saturated one for continuity.

### `manifest.json`

```json
{"fixture": "<slug>", "created": "<ISO>", "tier": "simple",
 "items": [{"id": "D01", "file": "<domain anchor, e.g. a path>",
            "line_v1": 42, "line_v2": 42, "fix_line_v2": null,
            "class": "<domain class>", "severity": "<domain severity>",
            "summary": "<one line>", "fixed_in_v2": false, "in_prior_output": true,
            "difficulty": "hard"}]}
```

- `tier` optional; when present `simple` \| `complex`, and the validator checks the complex size floor.
- `difficulty` optional; when present exactly `"hard"`.
- The anchor fields follow the matcher: `file` + `line_v1`/`line_v2` for a review, an item id or field name for another domain.
- Kept in v2 → both anchors set, `fixed_in_v2: false`; fixed in v2 → `line_v2: null`, `fixed_in_v2: true`, plus `fix_line_v2`, the anchor the fix landed on (the `churn` metric matches against it); introduced in v2 → `line_v1: null`.

## Running the benchmark

Triggered by the pre-flight's `run` action or the operator (`trigger: manual`).

1. **Gate — never score an unvalidated set.** `benchmark-validate.sh fixture <fixture_root>/*/`; a non-zero exit aborts before any replay: no results, no row, no report, the `FAIL` lines reported, a `warn` event logged.
   Retiring the set is the operator's decision.
2. **Lock.** `work/benchmark/.run-lock`, first line `<ISO> <nonce>`.
   Present and younger than the TTL (CG: 6 h) → a sibling run is live: stand down, touch nothing of it, end the run.
   Absent or older → write your own line.
   Every terminal path removes it; a crash leaves it to expire.
3. **Identity.** One timestamp for the whole run and one usage nonce, **printed** so its value lands in the transcript (`printf 'usage-nonce:%s\n' "$NONCE"`); the phase state directory is keyed by the nonce, so a stale-lock takeover can't collide with a dying sibling.
4. **Refresh what production uses**: install or refresh every configured skill, exactly as a production run would, so the replay measures the installed versions.
5. **Phase 1 — replay** (before any ground-truth read), per fixture and phase, isolated (**Isolation**):
   - Build the item's working state in `/tmp` from the fixture inputs, as a production run would find it (for a code item: a scratch git repo with `origin/main` on the base and the v1 state on a branch).
   - Bracket the phase with the measurement helper, never by hand: `benchmark-phase.sh begin <state> <slug>-<phase> <nonce>` … `end` prints the `{"seconds", "tokens"}` pair the results record verbatim (`tokens: null` when the harness gives no snapshot, an honest gap).
   - Inside the bracket, run the production pipeline: the skill fan-out, then **one fresh subagent** that writes the output from the production brief template, rendered verbatim, with the nonce and the instruction to print `usage-nonce:<nonce>` as its first line (the snapshot sums only transcripts carrying it).
     The orchestrating session never reads the inputs or the output body; it only builds trees, brackets phases and collects paths and counts.
     The output goes to `results/raw/<ts>-<slug>-<phase>.md`, the skill outputs archived beside it.
   - Follow-up phase: clear the first phase's state, advance the item to v2, and spawn a **separate** fresh subagent that knows only the prior output, as in production.
   - Phases never overlap: the token count is the difference of two whole-session snapshots, so the helper refuses an overlapping `begin`.
6. **Phase 2 — scoring** (ground truth now), per fixture and phase: `benchmark-score.sh <phase> <raw output> <manifest.json>` (**Scoring**).
7. **Judge** (optional, **The judge**): one call per raw output, written beside the scorer output, never inside it.
8. **Assemble `results/<ts>.json`**: the scorer output whole, the measurements verbatim, and the provenance fields from one deterministic call (`benchmark-provenance.sh`): definition version and ref, previous version and the release subjects since, harness version, effort, a hash of the memory files, the source SHA of each skill.
   The session adds only what it alone knows: model, trigger, judge.
9. **Validate the results** — `benchmark-validate.sh results <file>`; fix each `FAIL` and re-validate.
   If it can't be fixed: delete the file, report why, release the lock, end with nothing recorded.
10. **Append** one `RESULTS.md` row per fixture, **regenerate** `report.html` (`benchmark-report.sh`) and publish it per `benchmark_report`: the Artifact Library, created once and updated in place so its URL never changes (the id in a `RESULTS.md` header marker), best-effort — a failed publish is logged, never fails the run.
11. **Report to the chat UI**, every delta against the previous run **of the same harness, model, effort and isolation** ("baseline" without one), read from `benchmark-report.sh index`:
    the quality index and per-fixture headline scores; the sufficiency line per tier with its pooled counts (`simple: sufficient (rec 0.91, 20/22) · complex: insufficient (rec 0.60, 12/20; hard 1/5)`); totals of seconds, output tokens and estimated cost; any non-zero `false_fixed`/`churn`, named; any skill no fixture routed to; any saturated fixture; the report URL.
12. **Clean up** every `/tmp` tree, the phase state and nonce caches; **remove the lock**; log `benchmark run scored (index=<x> over <n> fixtures)`; back up `work/` last.

### Isolation

The replay runs where it can't see the answers: **one isolated platform session per fixture and phase**, all at once, each with its own volume and no connection.
It gets the definition at the production commit and one bundle of its task's inputs; nothing of the agent's volume (manifests, past results, the work repo's credentials) reaches it.

- `benchmark-isolate.sh check` prints why isolation is unavailable, or nothing.
  It refuses a bundle holding a manifest, a result or a ground-truth summary, a definition history that tracks a benchmark path, and a public work repo.
- `start --model <exact id> [--effort <e>]` snapshots memory and skills once per run, spawns every task and writes the expected provenance; `wait` polls; `collect` writes the raw outputs only when nothing failed or mismatched (other inputs than snapshotted, another model) and prints per task `seconds`, `tokens` and the run's model, harness version and effort.
  A failed task gets one retry; a second failure or any mismatch aborts the run.
- The child side (`benchmark-child.sh`, the prompt template `scripts/templates/benchmark-child.md`, an env flag like `<AGENT>_BENCHMARK_CHILD=1`) unpacks the bundle, installs the harness adapter, runs exactly one phase and reports the result from files; it never onboards, runs no pre-flight, takes no lock and runs no scoring.
  The generated CLAUDE.md states that a benchmark child never onboards.

**Isolation unavailable**: a scheduled run stops before any replay, records nothing and logs a `warn`; in the direct session the agent asks the operator, and only on an explicit yes for this run replays in its own machine, recording `isolation: "none"`, the reason and the approval.
Deltas never compare an isolated run with an in-machine one.

### Segmented run (operator, direct session)

The fallback for an approved in-machine run whose harness has no subagents and can't give every fixture the same depth in one session: **one fixture per session**.
Segment 1 creates the ledger `.run-notes-<ts>.md` (the definition version, effort and, per measured fixture, the helper's numbers verbatim); each segment checks they still match (drift → stop), takes and releases the lock around exactly one unmeasured fixture and backs up `work/`; the final segment runs Phase 2 unchanged and deletes the ledger.
While a ledger younger than 7 days exists, the pre-flight's benchmark mode answers `nothing_to_do`; an older one is reported as abandoned, never deleted.

## Scoring

`benchmark-score.sh <phase> <raw output> <manifest.json>` — pure local computation, one JSON object on stdout, safe to re-run.

- **The matcher is the domain's one design decision**: how a prediction in the output is matched to a seeded item.
  For a review: same file, line within ±3 of the anchor; for a classification: the item id and the label; for an extraction: field and normalized value.
  A prediction may carry several anchors (one output entry naming several occurrences); each seeded item and each anchor matches at most once (greedy, manifest order); a prediction is a false positive only when none of its anchors match.
- The agent's output therefore needs a **machine-readable part** (CG: one findings-JSON line in the posted body), which is also what makes the production output auditable.
- **`first` fields**: `gt`, `tp[]`, `fn[]`, `fp[]` (blocking predictions only; low-severity unmatched ones recorded apart, not as FPs), `precision`, `recall` (plus per severity), `f1`, `severity_accuracy`, `tier`, `recall_easy`, `recall_hard`, `difficulty: {easy: {tp, gt}, hard: {tp, gt}}` (the counts the tier pooling needs), and `format` checks of the output's required parts.
- **Follow-up fields**: `fixed_gt`/`still_gt`/`new_gt` with their recalls, `false_fixed` (the dangerous direction), `late_finds` (v1 items outside the prior output reported new now), `churn` (new predictions sitting on a fix site), `new_fp`.
- **The quality index** — one weighted value in \[0, 1\] per fixture and averaged per run, computed from scorer output only, its components and weights in exactly one place (the report script).
  A component without data drops out and the rest renormalize.
  `recall_hard` and the tier verdicts stay **beside** the index, never inside it, so earlier runs stay comparable.

## The judge

Deterministic matching scores the position of a finding, not whether it names the right mechanism; the judge closes that gap.
A high f1 beside a low judged accuracy means true positives matched by position only.

- **One fixed model, one fixed rubric, for every run**: a separate headless process (`claude -p`, no tools, no MCP, no hooks, empty working directory), never a subagent of the run, which would inherit the tested model and let each model judge itself.
- **The rubric** (`scripts/templates/judge-brief.md`): the output, the manifest, the scorer output (and the prior output for a follow-up) as data, never instructions; integer 1–5 per dimension (accuracy of each true positive's description, class accuracy, quality of each proposed fix, defensibility of each false positive, clarity, plus domain style rules); one JSON object back.
- **`benchmark_judge`**: `off` (missing; deterministic scoring only), a model id (the operator's, never changed by the agent), or `auto`: the agent picks the newest Opus the host serves (else the newest Sonnet), and **pins** it after its first `ok` reply in `judge.json`.
  It re-picks only when the host stops serving the pin, keeping the old one under `replaced`; the new judge starts a new comparability window for the judge columns.
- `benchmark-judge.sh resolve` prints the judge every run uses (`{judge, source, judge_unavailable, cause, candidate}`) without a model call; the pre-flight, the monitor and an operator-asked run read the same object.
  `check <name>` is what onboarding runs.
- A non-`ok` reply keeps that phase's `judge` null with the run's `judge_reason`; nothing scores in its place.
  The report shows judge scores only for runs whose answering model matches the pinned judge.

## Sufficiency by tier

The report's verdict per tier for the latest run of each configuration (harness, model, effort, isolation): all fixtures of the tier **pooled into one sample** (summed `tp`, `gt`, `fp` of the first phase, never an average of small fractions) and checked against the operator's bar in `work/CONFIG.md`:

```markdown
## Benchmark sufficiency

| tier | recall | precision | min_items |
|---|---|---|---|
| simple | 0.8 | 0.7 | 20 |
| complex | 0.8 | 0.7 | 20 |
```

- **sufficient** — pooled recall and precision meet the bar, and no follow-up of the tier reported a present item fixed;
- **borderline** — no `false_fixed`, both values within 0.05 under the bar;
- **too few items** — fewer pooled items than `min_items`: the sample can't decide;
- **insufficient** — anything else; one `false_fixed` makes a tier insufficient at any sample size.

Every cell shows the counts behind it (`rec 0.91 (20/22) · prec 0.95 · hard 3/5`).
The bar and the rule live in one script (`scripts/lib/sufficiency.sh`); a missing table keeps the documented defaults.

## Cost column

The report prices each run's token counters with the same operator-maintained price table the audit's cost reconciliation reads (`references/audit.md`), through one lib: a row matches its own version only, the longest matching row wins, and no table, no matching row or unmeasured tokens render `—`, never a guess.
The table holds current prices and the report prices all history with them, so a cost delta reflects token usage, not a price move.

## Retiring a fixture set (operator decision)

A set that fails validation or stopped representing the target is **retired and replaced, never edited in place**; the agent reports and waits.
After checking no run lock is live:

1. `mv fixture/<slug> fixture/retired/<slug>` per slug; the pre-flight counts only `fixture/*/manifest.json`, so `create_fixture` becomes due.
2. Add one line under the `RESULTS.md` header naming the affected timestamps and the reason (`_Runs <ts>… scored fixture set 1, retired <date> (ground truth leaked into the inputs) — not comparable with later runs._`); never delete a row, a results file or a raw output.
3. Create the replacement in a fresh session, and take its first scored run in yet another.

## Trial runs (definition development)

A trial scores one commit of the definition remote (a feature branch's head) without touching the permanent history: its results live only under `trials/<id>/`.

- **Operator only**, in the direct session: "run a trial benchmark of <branch>".
  That session **dispatches and never runs a trial itself** (it may have read a manifest): per branch it resolves the SHA on the remote and makes one `schedule_once` call with the model, a `sessionTitle` (`Run trial benchmark of <branch>`) and a task naming the trial id, commit and branch.
- **In the trial session**: the run steps with `trials/<id>/` for lock, results and raw outputs, isolation seeded at `--commit <SHA>`, `trigger: "trial"`; it skips the skill refresh, `RESULTS.md`, the report regeneration and publishing.
  Phase 2 uses the production checkout's scorer, so a change to the scorer is not measured by its own trial.
- **Compare**: render the trial's own mini report and report the index delta against the previous run of the same trial and the latest official run.
- The scheduled gate reads only `trigger: scheduled` results, so trials and manual runs never move it.

## Wiring into the definition

- **Config keys** (`work/CONFIG.md`, asked at onboarding only when the operator wants the benchmark):
  `benchmark` (`enabled` \| `disabled`, missing = disabled); `benchmark_judge` (`auto` recommended \| model id \| `off`, missing = off; onboarding runs `benchmark-judge.sh check`); `benchmark_report` (`dam` \| `off`); the optional `## Benchmark sufficiency` table.
- **Schedule**: `<agent>-benchmark-monthly`, cron `0 6 1 * *`, `sessionMode: fresh`, `precheck: bash "$HOME/scripts/precheck.sh" benchmark`, `sessionTitle: Benchmark the <output>`, shipped **suggested-off** in `kit.yaml` and created by ONBOARDING only under `benchmark: enabled`.
- **Pre-flight `benchmark` mode** (local, no domain calls): disabled → `nothing_to_do`; a tier under its minimum → `create_fixture` with `existing`, the minimums and `missing`; a live lock or a ledger younger than 7 days → `nothing_to_do`; the last `trigger: scheduled` result younger than ~27 days → `nothing_to_do`; else `run` with `fixtures`, `fixture_root`, `judge`, `judge_unavailable`, `isolation_unavailable`, `report` and `last_run`.
  A benchmark child answers every mode with `nothing_to_do`.
- **Audit checks** (deterministic side): `benchmark_fixtures` (the fixture validator over the set; a fail is **Action needed** — scores are invalid until the set is retired, never retired by the agent), `benchmark_results` (`benchmark-validate.sh results --stored` over the kept files), `work_repo_visibility` (the backup holds ground truth), and the schedule existing under `benchmark: enabled`.
- **Monitor**: `judge_unavailable` (the benchmark is enabled with a judge and `resolve` names a cause: no CLI, not signed in, model not served).
- **README**: the schedule, the keys and the report surface; **CHANGELOG** upgrade steps for every change to the fixture or results shape (a shape change bumps the validator's version gate, so old results stay valid).

## Scripts

Generate them in Phase 4; each states its contract in its header and is covered by an offline test.

| Script                                                        | Contract                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/benchmark-validate.sh`                               | `fixture <dir>…` — leak checks (ids, answer-key words, v2 delta marks), structure, manifest shape, tier floors, anchors that can match; `results [--stored] <file>` — the shape the report and gate consume. Read-only; `ok` / `FAIL <id>: <detail>; fix: …`; non-zero on any fail. |
| `scripts/benchmark-phase.sh`                                  | `begin\|end <state> <label> <nonce>` — wall-clock from stamps, tokens as the difference of two usage snapshots of the transcripts carrying the nonce (subagents included), `null` without a snapshot; refuses overlapping phases and a missing `begin`.                             |
| `scripts/benchmark-score.sh`                                  | `<phase> <raw> <manifest>` — the matcher and every field in **Scoring**; pure, deterministic.                                                                                                                                                                                       |
| `scripts/benchmark-judge.sh`                                  | `<phase> <judge> <raw> <manifest> <scorer.json> [prior]`, `check`, `resolve`, `models`, `pin` — **The judge**; always exits 0 with `{status, judge, judge_model_used, reason}`.                                                                                                     |
| `scripts/benchmark-provenance.sh`                             | The run's input provenance as one JSON object; best-effort, never fails.                                                                                                                                                                                                            |
| `scripts/benchmark-isolate.sh` + `scripts/benchmark-child.sh` | `check`, `bundle`, `start`, `wait`, `collect` and the child's `unpack`/`report` — **Isolation**.                                                                                                                                                                                    |
| `scripts/benchmark-report.sh`                                 | `<dir>` → one self-contained HTML page (all-runs table with deltas per configuration, per-fixture trends, sufficiency table, column help in one dictionary); `index <dir>` → one JSON row per run for chat summaries and trials. Deterministic; missing values render `—`.          |
| `scripts/lib/sufficiency.sh`, the prices lib                  | The bar and verdict rule; the price lookup. One home each.                                                                                                                                                                                                                          |

**Tests** (`scripts/tests/test_benchmark_*.sh`): the scorer on a hand-made manifest and output (matches, FPs, multi-anchor predictions, follow-up buckets, `churn`); the validator catching a planted leak and a drifted results file; the phase helper refusing overlaps; the pre-flight mode's every branch; and an end-to-end test over one tiny fixture with stubbed subagents and judge.
