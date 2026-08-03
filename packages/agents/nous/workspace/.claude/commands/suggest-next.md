Given a user's research intent, retrieve prior knowledge from the cross-campaign registry and recommend how to frame a new campaign.

## Usage

`/suggest-next <repo_path_or_project_name> <intent>`

Examples:
- `/suggest-next /path/to/inference-sim "improve admission control fairness across priority bands"`
- `/suggest-next inference-sim "reduce tail latency under burst workloads"`
- `/suggest-next` (no arguments — list available projects and ask)

## Argument Parsing

- If `$ARGUMENTS` is empty, read `~/.nous/wiki/registry.json`, list all projects (by name and path), and ask the user which project and what their research intent is.
- If `$ARGUMENTS` starts with a path (contains `/`) or matches a project name in the registry, use it as the project filter. Everything after it is the intent.
- If `$ARGUMENTS` doesn't match any project, treat the entire argument as the intent and ask the user which project to use.

## Algorithm

The algorithm has five phases: **A: Retrieval** (script-driven, deterministic), **B: Synthesis** (LLM reasoning over the retrieved context), **C: Output** (write markdown), **D: Format** (file structure), and **E: Campaign Generation** (interactive YAML creation). The LLM selects what to retrieve; the script does the mechanical graph traversal and filtering.

---

### Phase A: Retrieval

#### A1. Load Registry and Match Project

Read `~/.nous/wiki/registry.json`. Find the project entry matching the user's repo path or project name:
- Try exact path match against `projects` keys
- Try substring match (user might give just the repo name, match against the end of each key)
- Try fuzzy match against project `name` fields

If not found, report: "No prior knowledge for this system. Available projects:" and list them. **STOP.**

#### A2. Select Campaigns and Entities (LLM judgment)

From the matched project's registry entry, select:

- **Exactly 3 campaign names** (or all campaigns if fewer than 3 exist) — rank by relevance to the user's intent using `research_question`, `concepts[].name`, and `frontiers[].title`
- **Exactly 6 entity names** (or all entities if fewer than 6 exist) — from the project-level `entities` array, pick those whose `name` or `aliases` relate to the user's intent. Also include entities that appear in the selected campaigns if their role is relevant.

#### A3. Run Retrieval Script

Call the retrieval script with the selected campaigns and entities:

```bash
python scripts/retrieve_wiki_context.py \
  -c <campaign-1> <campaign-2> ... \
  -e "<Entity Name 1>" "<Entity Name 2>" ... \
  -i "<user's research intent>"
```

The script:
1. Builds a knowledge graph from each campaign's `concepts.json` (nodes = entities/concepts/parameters, edges = shared principles)
2. Extracts the subgraph reachable from the specified entities (1-hop via principle overlap)
3. Loads principles from `principles.json` — only those referenced by the subgraph
4. Loads all dead-ends from `dead-ends.json`
5. Loads frontiers and interactions filtered by the scoped principle IDs
6. Outputs a structured context block to stdout

#### A4. Read Script Output

Capture the script's stdout. This is the **Retrieved Context** block that feeds Phase B.

---

### Phase B: Synthesis

Using the assembled context block from Phase A, generate **top 3 recommended campaign framings**. For each recommendation:

1. **Score it** on five dimensions:
   - **Novelty (weight 0.25):** How far is this from known dead-ends? Does it explore genuinely new territory?
   - **Foundation (weight 0.20):** How many scoped principles does it build upon? Stronger foundation = higher confidence.
   - **Impact (weight 0.25):** Based on related results, what's the estimated effect size? Prioritize high-impact experiments.
   - **Testability (weight 0.15):** Can this be validated in a single campaign run? Concrete, bounded experiments score higher.
   - **Efficiency (weight 0.15):** How cost-effective is this experiment predicted to be? Score based on:
     - Predicted cost relative to predicted impact (low cost + high impact = high efficiency)
     - Whether the experiment can reuse cached context from prior runs (cache reads reduce cost)
     - Whether a cheaper model configuration could work (e.g., Sonnet-only for refinement campaigns vs Opus+Sonnet for exploratory)
     - Fewer predicted iterations = higher efficiency

2. **For each recommendation, provide:**
   - A suggested `research_question` (1-2 sentences, phrased as a testable question)
   - Which entities/concepts from the context block it builds on (with brief context)
   - Which frontiers it addresses (by ID and title)
   - Which interactions it could test (by ID and title)
   - Which dead-ends to explicitly avoid (by ID and brief reason)
   - Score breakdown (Novelty/Foundation/Impact/Testability/Efficiency + weighted total)
   - Predicted cost (iterations × cost/iter, with basis for estimate)
   - Suggested model configuration (which models for design/execute phases, with rationale)

### Phase C: Output File

Write the full recommendation to a markdown file at:

```
~/.nous/wiki/suggestions/<YYYY-MM-DD>-<slugified-intent>.md
```

- Create the `~/.nous/wiki/suggestions/` directory if it doesn't exist.
- Slugify the intent: lowercase, replace spaces with `-`, strip non-alphanumeric characters, truncate to 50 chars.
- If the file already exists (same date + intent), append a numeric suffix (`-2`, `-3`, etc.).

After writing the file, print a short summary to the terminal:

```
Wrote: ~/.nous/wiki/suggestions/<filename>.md

Top recommendations:
  1. <title> — score: <total>/1.0
  2. <title> — score: <total>/1.0
  3. <title> — score: <total>/1.0
```

### Phase D: File Format

The markdown file should follow this structure. The scoring table is **required** for every recommendation — it is the primary decision-making artifact.

```markdown
# Suggest-Next: <project name>

**Date:** <YYYY-MM-DD>
**Research intent:** "<user's intent>"
**Prior campaigns:** <count>
**Total confirmed principles:** <count>
**Campaigns consulted:** <comma-separated names>
**Entities scoped:** <comma-separated names>

---

## Scoring Summary

| # | Recommendation | Novelty | Foundation | Impact | Testability | Efficiency | **Total** |
|---|---------------|---------|-----------|--------|-------------|------------|-----------|
| 1 | <short title> | X.XX | X.XX | X.XX | X.XX | X.XX | **X.XX** |
| 2 | <short title> | X.XX | X.XX | X.XX | X.XX | X.XX | **X.XX** |
| 3 | <short title> | X.XX | X.XX | X.XX | X.XX | X.XX | **X.XX** |

*Weights: Novelty 0.25, Foundation 0.20, Impact 0.25, Testability 0.15, Efficiency 0.15*

---

## Recommendation 1: <short title>

**Suggested research question:**
> <1-2 sentence testable question>

### Score Breakdown

**Weighted total: X.XX/1.0**

| Dimension    | Weight | Score | Rationale |
|-------------|--------|-------|-----------|
| Novelty     | 0.25   | X.XX  | <brief — what makes this novel or not> |
| Foundation  | 0.20   | X.XX  | <brief — which principles it builds on> |
| Impact      | 0.25   | X.XX  | <brief — expected effect size and why> |
| Testability | 0.15   | X.XX  | <brief — how bounded/measurable it is> |
| Efficiency  | 0.15   | X.XX  | <brief — cost/impact ratio reasoning> |

### Builds on
- <Entity/Concept name> — <how it's relevant>
- ...

### Addresses frontiers
- F-N: <title> — <how this experiment would push the boundary>
- ...

### Tests interactions
- I-N: <title> — <what combining these would reveal>
- ...

### Avoid (dead-ends)
- DE-N: <title> — <why this failed before>
- ...

### Predicted cost

| Metric | Estimate | Basis |
|--------|----------|-------|
| Iterations | N-M | <reasoning: refinement/exploratory, builds on N principles, etc.> |
| Cost/iter | ~$X.XX | Project historical average (adjusted if applicable) |
| Total | $XX-YY | iterations × cost/iter |
| Duration | ~Xh | Based on avg duration/iter from similar campaigns |

### Model configuration
- Design phase: <model> (<rationale>)
- Execute phase: <model> (<rationale>)
- Alternative: <cheaper/costlier option with savings estimate>

**Efficiency note:** <1 sentence on why this cost is justified relative to expected impact>

---

## Recommendation 2: <short title>

<same structure as Recommendation 1>

---

## Recommendation 3: <short title>

<same structure as Recommendation 1>

---

## Next Steps

To start a campaign from these recommendations, use the interactive generator below or manually:
1. Select recommendations to generate `campaign.yaml` files (Phase E prompt follows)
2. Review and adjust the generated config if needed
3. Run: `nous run <path-to-campaign.yaml>`
4. After completion, run `/post-campaign` to feed results back into the registry
```

### Phase E: Interactive Campaign Generation

After printing the terminal summary (end of Phase C), offer to generate executable `campaign.yaml` files from the recommendations.

#### E1. Ask the User

Use AskUserQuestion to present choices:

**Question:** "Which recommendations would you like to generate campaign.yaml files for?"

**Options:**
- "1" — Generate for recommendation 1 only
- "2" — Generate for recommendation 2 only
- "3" — Generate for recommendation 3 only
- "All" — Generate for all recommendations
- "None" — Skip campaign generation

Allow multi-select (the user can pick e.g. "1" and "3").

If the user selects "None", print `No campaigns generated.` and **STOP**.

#### E2. Generate campaign.yaml for Each Selected Recommendation

For each selected recommendation, produce a YAML document with these field mappings:

| campaign.yaml field | Source |
|---|---|
| `research_question` | Recommendation's suggested research question (verbatim from the `> <question>` block) |
| `run_id` | Slugified recommendation title (lowercase, hyphens, ≤50 chars) |
| `max_iterations` | Upper bound from the "Iterations" row in the Predicted cost table (e.g., "6-8" → 8) |
| `target_system.name` | From registry `projects[key].name` |
| `target_system.description` | Synthesized from registry project description + recommendation context |
| `target_system.repo_path` | The project key (path) from the registry |
| `target_system.observable_metrics` | Inferred from recommendation's Impact rationale (omit field entirely if not confidently inferable) |
| `target_system.controllable_knobs` | Parameter names from "Builds on" section (omit field entirely if not confidently inferable) |
| `prompts.methodology_layer` | `"prompts/methodology"` (standard default) |
| `prompts.domain_adapter_layer` | `null` |
| `models.design` | From recommendation's "Model configuration → Design phase" model name |
| `models.execute_analyze` | From recommendation's "Model configuration → Execute phase" model name |
| `metadata` | Traceability block (see E3) |

**Schema compliance rules:**
- Do NOT include any fields not in `orchestrator/schemas/campaign.schema.yaml`
- Root object: only `research_question`, `run_id`, `max_iterations`, `target_system`, `prompts`, `models`, `metadata`
- `target_system`: only `name`, `description`, `repo_path`, `observable_metrics`, `controllable_knobs`, `live_target`
- `prompts`: only `methodology_layer`, `domain_adapter_layer`
- `models`: only `design`, `execute_analyze`, `report`
- Omit optional fields rather than including empty values
- Model values default: `claude-opus-4-6` (design), `claude-sonnet-4-6` (execute_analyze)

#### E3. Metadata Traceability Block

Include a `metadata` section for provenance tracking:

```yaml
metadata:
  source_suggestion: "<YYYY-MM-DD>-<slug>.md"
  recommendation_rank: <1|2|3>
  research_intent: "<user's original intent verbatim>"
  builds_on_frontiers: ["F-1", "F-3"]
  tests_interactions: ["I-2"]
  avoids_dead_ends: ["DE-1", "DE-4"]
  foundation_principles: ["RP-5", "RP-12"]
  composite_score: 0.XX
```

- Use the actual IDs from the recommendation's "Addresses frontiers", "Tests interactions", "Avoid (dead-ends)" sections
- `foundation_principles`: principle IDs referenced in the Foundation score rationale
- `composite_score`: the weighted total from the scoring table

#### E4. Write Files

Write each generated YAML to:

```
~/.nous/wiki/suggestions/campaigns/<YYYY-MM-DD>-<slugified-intent>-<N>.yaml
```

Where `<N>` is the recommendation number (1, 2, or 3).

- The `<YYYY-MM-DD>-<slugified-intent>` prefix matches the suggestion markdown filename (without `.md`)
- If the file already exists, append a numeric suffix before `.yaml` (e.g., `-1-2.yaml`)
- Create `~/.nous/wiki/suggestions/campaigns/` if it doesn't exist

#### E5. Print Execution Instructions

After writing all campaign files, print:

```
Generated campaign files:
  <N>. ~/.nous/wiki/suggestions/campaigns/<filename>.yaml
     Run: nous run <full-path>

  ...
```

Example:
```
Generated campaign files:
  1. ~/.nous/wiki/suggestions/campaigns/2026-06-03-improve-fairness-1.yaml
     Run: nous run ~/.nous/wiki/suggestions/campaigns/2026-06-03-improve-fairness-1.yaml
  3. ~/.nous/wiki/suggestions/campaigns/2026-06-03-improve-fairness-3.yaml
     Run: nous run ~/.nous/wiki/suggestions/campaigns/2026-06-03-improve-fairness-3.yaml
```

---

## Model Configuration Guidance

When suggesting models for a recommendation, use the **Cost Context** section from the retrieved context and apply these heuristics:

- **Opus design + Sonnet execute** (default): For campaigns exploring new territory, combining multiple approaches, or where the design phase needs to reason about complex interactions. Historical cost: ~$5.50-6.00/iter.
- **Sonnet design + Sonnet execute** (cheaper, ~45% savings): For campaigns that are narrow refinements of known-good configurations — the design space is well-constrained by prior principles. Historical cost: ~$3.00-3.50/iter estimate.
- **Opus both** (expensive, ~80% increase): Only for campaigns that need deep analysis in the execute phase (e.g., debugging subtle failures where Sonnet might miss root causes). Historical cost: ~$10-11/iter estimate.

Iteration count heuristics:
- **Refinement** (builds on 3+ confirmed principles, narrow scope): 4-6 iterations
- **Exploratory** (new territory, tests interactions, <2 confirmed principles to build on): 8-12 iterations
- **Standard** (mix of known and new): 6-8 iterations

## Important Rules

- This skill **writes files only to `~/.nous/wiki/suggestions/`** — the suggestion markdown at the top level, and optionally campaign YAML files in the `campaigns/` subdirectory. It never modifies registry files, campaign data, or any other existing files.
- All reasoning happens in-context using the LLM's judgment — no external scripts beyond `retrieve_wiki_context.py`.
- If the registry is empty or the project has no campaigns, say so clearly and suggest the user run their first campaign manually.
- Always ground recommendations in specific prior data (principle IDs, frontier IDs, dead-end IDs). Never hallucinate IDs that don't exist in the loaded files.
- Keep recommendations actionable — each should be concrete enough to immediately write a `campaign.yaml` from.
- Prefer recommendations that combine insights from multiple campaigns over those that just extend a single campaign.
- Always use the Cost Context section to ground cost predictions in real data — never invent cost numbers without historical basis.
- **Scoring transparency is non-negotiable** — every recommendation must include its full score breakdown table with per-dimension rationale. The summary table at the top lets users compare at a glance.
