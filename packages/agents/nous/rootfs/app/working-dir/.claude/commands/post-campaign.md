Index a completed Nous campaign into the shared wiki and generate a visualization.

## Steps

1. **Find the campaign**: If `$ARGUMENTS` is provided, use it as the path to the `.nous/<campaign>/` directory. Otherwise, search for directories containing both `ledger.json` and `principles.json` under `.nous/` paths in the project or `~/Downloads/`, and ask the user which to index.

   **Style passthrough**: If `$ARGUMENTS` contains `::`, split on the **first** occurrence only. The left side is the campaign path (used for indexing steps 2-10). The right side is the style intent — it is ignored during indexing and only forwarded to `/visualize-campaign` in step 11. The campaign **name** (derived from the path's directory name) is what gets passed to `/visualize-campaign`, not the full path.
2. **Read campaign artifacts**: Read `ledger.json`, `principles.json`, and `campaign.yaml` from the campaign directory. Extract:
   - Campaign name (directory name)
   - Campaign date (earliest non-baseline timestamp from ledger iterations)
   - **Campaign context** from `campaign.yaml`:
     - `research_question` — the overarching question being investigated
     - `target_system.name` — the system under test
     - `target_system.description` — what the system does
     - `target_system.repo_path` — path to the target repository
   - **Runtime metadata** from `campaign.yaml` (under `runtime:` block, if present):
     - `runtime.target_commit` — git SHA of target repo at campaign start
     - `runtime.target_repo` — org/repo identifier
     - `runtime.nous_version` — Nous version used
     - `runtime.started_at` — ISO timestamp of campaign initialization
   - All iterations with their outcomes (`h_main_result`), families, and prediction accuracy
   - All principles with full fields (statement, confidence, regime, mechanism, applicability_bounds, contradicts, superseded_by, status)

   If `campaign.yaml` doesn't exist in the campaign directory, check for `report.md` and extract the research question from its opening section. If neither exists, ask the user for the campaign context.

   The campaign context will be embedded in JSON metadata for each output file.

3. **Check idempotency**: Check if `~/.nous/wiki/campaigns/<campaign-name>/concepts.json` exists. If it does, report "Campaign already indexed — skipping to visualization" and jump to step 11.

4. **Write dead-ends.json**: Write a JSON array to `~/.nous/wiki/campaigns/<campaign-name>/dead-ends.json`.

   Dead-ends are approaches that were tested and conclusively don't work. Each entry must be **self-contained**: another agent reading this should understand what was tried, why it failed, and when to avoid it — without looking at any other file.

   For each iteration where `h_main_result == "REFUTED"`:
   - Find the principles extracted in that iteration
   - Synthesize a self-contained explanation of the failure

   ```json
   [
     {
       "id": "DE-1",
       "title": "<descriptive title of what was attempted>",
       "iteration": "iter-N",
       "what_was_tried": "<1-2 sentences: the specific approach/configuration, with concrete values>",
       "why_it_failed": "<1-2 sentences: the causal mechanism>",
       "avoid_when": "<specific conditions under which this fails>"
     }
   ]
   ```

   Number IDs sequentially starting from DE-1 within this campaign.

5. **Write frontiers.json**: Write a JSON array to `~/.nous/wiki/campaigns/<campaign-name>/frontiers.json`.

   Frontiers are the edges of what this campaign explored — where knowledge ends and the next experiment begins. Each frontier must be **self-contained**: a reader should understand it without looking at principles.json or the Principles tab.

   Identify frontiers by looking for **high-confidence** principles only:
   - High-confidence principles from PARTIALLY_CONFIRMED iterations (boundary was actively hit)
   - High-confidence principles whose `applicability_bounds` explicitly mentions untested territory
   - High-confidence confirmed principles that were tested under narrow conditions (specific rates, cluster sizes, durations) where adjacent conditions remain unexplored

   **Skip all medium and low confidence principles** — they aren't established enough to define meaningful boundaries.

   ```json
   [
     {
       "id": "F-1",
       "title": "<descriptive title of the frontier — what's at the edge>",
       "what_was_tried": "<1-2 sentences: the specific experiment/configuration that was run, using concrete values>",
       "what_was_left_untried": "<1-2 sentences: the adjacent territory not explored>",
       "what_to_try_next": "<1 sentence: a concrete, actionable experiment>",
       "related_principles": ["RP-5", "RP-18"]
     }
   ]
   ```

   Write 5-10 frontiers per campaign. Prioritize frontiers where the next experiment is clearly actionable. **Only include frontiers based on high-confidence principles.**

6. **Write interactions.json**: Write a JSON array to `~/.nous/wiki/campaigns/<campaign-name>/interactions.json`.

   Interactions are untested combinations of independently-validated approaches that might compound, conflict, or reveal new behavior when used together. Each entry must be **self-contained**: another agent should understand what the two approaches do individually, why combining them is interesting, and what experiment to run — without looking at any other file.

   Identify interactions by:
   - Looking for pairs of CONFIRMED principles that address different mechanisms and were never validated together
   - Focusing on approaches that operate in adjacent or overlapping conditions
   - Limit to 3-5 most interesting interactions to avoid noise

   ```json
   [
     {
       "id": "I-1",
       "title": "<descriptive title of the combination>",
       "approach_a": "<1-2 sentences: what the first approach does, under what conditions, what it achieves>",
       "approach_b": "<1-2 sentences: what the second approach does, under what conditions, what it achieves>",
       "why_combine": "<1-2 sentences: why these together might produce better results>",
       "experiment_to_run": "<1 sentence: a concrete, actionable experiment configuration>",
       "related_principles": ["RP-8", "RP-17", "RP-18"]
     }
   ]
   ```

7. **Write campaign summary**: Write `~/.nous/wiki/campaigns/<campaign-name>/summary.md` (create directory if needed). Skip if the file already exists.

    Read the campaign's `report.md` if it exists for additional context. Generate:

    ```
    # <campaign-name>

    **Date:** <date>
    **Iterations:** <count of non-baseline iterations>
    **Key question:** <from report.md opening or inferred from iteration families>

    ## Outcome
    <2-3 sentence answer based on the pattern of confirmations/refutations>

    ## Iteration arc
    <Brief narrative: what families were explored, which confirmed/refuted, key pivots>

    ## Key principles
    <Bulleted list of 5-10 most important high-confidence principles with IDs>

    ## Open questions
    <Bulleted list of frontiers and untested territory>
    ```

8. **Copy principles.json**: Copy the source campaign's `principles.json` to `~/.nous/wiki/campaigns/<campaign-name>/principles.json`.

9. **Copy llm_metrics.jsonl**: If `llm_metrics.jsonl` exists in the campaign directory, copy it to `~/.nous/wiki/campaigns/<campaign-name>/llm_metrics.jsonl`. This preserves per-iteration LLM cost data (model, cost, duration, turns) for the visualization's cost chart.

10. **Generate visualization data files**: Generate JSON files that feed the interactive graph. Save to `~/.nous/wiki/campaigns/<campaign-name>/` (create directory if needed).

    **a) `concepts.json`** — structured JSON for the Knowledge tab and Iterations sub-nodes.

    Index the campaign's vocabulary into three categories with strict ownership semantics:

    **The directed ownership graph**: `Entity ←(operates_on)← Concept →(owns)→ Parameter`
    - Entities are leaf nodes (no outgoing ownership edges)
    - Concepts are the central nodes connecting entities to parameters
    - Parameters are leaf nodes owned by exactly one concept
    - Every concept MUST point to ≥1 entity and 0+ parameters
    - Every parameter MUST point back to exactly 1 concept
    - **A parameter appears in exactly ONE concept's `parameters` array** — the concept that INTRODUCED and OWNS the knob. Other concepts that merely USE or are AFFECTED BY the parameter do NOT list it. "Uses" ≠ "owns."

    **Category definitions:**
    - **Concept**: A reusable algorithm, theory, or technique that Nous discovered and validated during this campaign. Must be self-contained — understandable and applicable without campaign-specific context. Concepts are transferable across campaigns (e.g., "Slope-Based Saturation Detection" is a concept; "iter-3 config" is not). A concept operates on one or more entities and owns zero or more parameters as its tweakable knobs. Did NOT exist before Nous ran.
    - **Parameter**: A numeric knob or threshold belonging to exactly ONE concept that was actively tuned during experimentation. The parameter's meaning derives entirely from its parent concept — it cannot exist independently. If you can't name which concept owns it, either the concept is missing or the parameter is misclassified.
    - **Entity**: A component that ALREADY EXISTED in the project's source code BEFORE this campaign ran. Entities are the pre-existing infrastructure that concepts operate ON — e.g., a scheduler, dispatcher, router, queue, or gateway that was already in the codebase. If the campaign INTRODUCED or CREATED a component (like a new detector, a new algorithm, a new module), that is a **Concept**, NOT an entity. The test: "Did this exist in the codebase before the campaign started?" If yes → Entity. If no → Concept. NOT model profiles, workload configurations, benchmark inputs, hardware specs, or experiment design choices. Entities do NOT own parameters — only concepts do.

    **Include metadata at top level:**
    ```json
    {
      "campaign_name": "<campaign-name>",
      "date": "<campaign date>",
      "repo_path": "<target_system.repo_path from campaign.yaml>",
      "system_name": "<target_system.name> — <target_system.description>",
      "research_question": "<research_question from campaign.yaml>",
      "target_commit": "<runtime.target_commit from campaign.yaml, or null>",
      "target_repo": "<runtime.target_repo from campaign.yaml, or null>",
      "nous_version": "<runtime.nous_version from campaign.yaml, or null>",
      "started_at": "<runtime.started_at from campaign.yaml, or null>",
      "concepts": [...],
      "parameters": [...],
      "entities": [...]
    }
    ```

    **Item schemas (MUST match exactly — the visualization script reads these field names):**

    ```json
    // Concept item:
    {
      "name": "Descriptive Name",
      "definition": "1-3 sentence explanation of what this is and how it works.",
      "principles": ["RP-1", "RP-7", "RP-10"],
      "operates_on": ["EntityName1", "EntityName2"],
      "parameters": ["paramName1", "paramName2"]
    }

    // Parameter item:
    {
      "name": "parameterName",
      "definition": "What this knob controls and its effect.",
      "principles": ["RP-7", "RP-10"],
      "parent_concept": "Concept Name That Owns This Parameter",
      "evolution": [
        {"iter": "iter-3", "value": "0.1", "outcome": "confirmed", "note": "Eliminated false positives at rate=20"},
        {"iter": "iter-10", "value": "0.05", "outcome": "confirmed", "note": "2.6% incremental critical gain"}
      ]
    }

    // Entity item:
    {
      "name": "ComponentName",
      "source": "path/to/file.go::TypeName",
      "definition": "What this pre-existing component does in the system.",
      "principles": ["RP-2", "RP-15"]
    }
    ```

    **Relationship field requirements (explicit edges — authoritative for knowledge graph):**
    - Every concept MUST have `operates_on` (array of ≥1 entity name) and `parameters` (array of 0+ parameter names)
    - Every parameter MUST have `parent_concept` (string — exactly 1 concept name that owns this parameter)
    - Names in `operates_on` MUST exactly match names in this file's `entities` array
    - Names in `parameters` MUST exactly match names in this file's `parameters` array
    - The `parent_concept` value MUST exactly match a name in this file's `concepts` array
    - These relationship fields are the authoritative graph edges — `principles` arrays are supplementary (used for iteration-linking and cross-campaign principle queries)

    **Relationship integrity checklist (run mentally before writing the file):**
    1. For each parameter P: can you name exactly one concept that P belongs to? If not, add the missing concept.
    2. For each concept C: does C.parameters list every parameter in the file whose parent_concept == C.name? (Bidirectional consistency)
    3. **Does any parameter name appear in MORE THAN ONE concept's `parameters` array?** This is always wrong. A parameter has one owner. If concept A introduced the knob and concept B merely uses it, only A lists it.
    4. For each concept C: does every name in C.operates_on appear in the entities array? If not, add the missing entity or fix the name.
    5. Is any parameter orphaned (not listed in ANY concept's `parameters` array)? Fix by adding it to its parent concept.
    6. Is any entity unreachable (not referenced by ANY concept's `operates_on`)? Either add a concept that operates on it, or remove the entity.

    **Field name requirements (visualization contract):**
    - Use `definition` (NOT `description`) — displayed in tooltip and detail panel
    - Use `principles` (NOT `related_principles`) — array of RP-IDs that reference this item; used to compute graph edges between items and to connect items to iterations
    - For `evolution`: use `iter` (NOT `iteration`), `value`, `outcome` (lowercase status: "confirmed"/"refuted"/"partially_confirmed"/"baseline"), `note` (explanation text)
    - Every concept, parameter, AND entity MUST have a `principles` array — this is how the graph determines which items share connections and which iterations they belong to

    Guidelines:
    - Extract 5-15 concepts, 3-10 parameters, and 5-10 entities per campaign.
    - Only include parameters that were actively varied during the campaign.
    - Skip common industry terms (TTFT, LLM, GPU, p99, etc.). Focus on campaign-specific vocabulary.
    - Every active principle MUST be referenced by at least one concept, parameter, or entity. The validator will reject dangling principles (present in principles.json but not referenced by any node). If a principle has no natural home, either create a concept that captures the pattern it describes, or attach it to the most relevant existing entity/concept.
    - The `evolution` array for parameters should include every iteration where the parameter's value was meaningfully varied.

    **Entity validation (mandatory):** After drafting the entity list, verify each entity is truly pre-existing — NOT something the campaign introduced. You cannot rely on git history (campaign code may not be committed). Instead, use these sources of truth:

    1. **campaign.yaml is the ground truth for what pre-existed.** The `target_system.description` and any `reference_code_paths` describe the system AS IT WAS before the campaign. Components mentioned there are entities.
    2. **Principles describe what the campaign CREATED.** Read principles.json — any algorithm, detector, technique, or module described as something the campaign implemented, discovered, or introduced is a Concept, never an Entity. If a principle says "we built X" or "X was introduced to improve Y", then X is a Concept.
    3. **The litmus test:** Could you describe this component in a sentence that makes sense WITHOUT mentioning this campaign? "The gateway queue dispatches requests to instances" → Entity (it's infrastructure). "The TTFT slope detector fires when latency slope exceeds a threshold" → Concept (the campaign created it to test a hypothesis).

    Remove or reclassify as Concept anything that fails this check. For each validated entity, note which part of `target_system` in campaign.yaml references it.

    **Entity name grounding (mandatory):** Entity names MUST come from the actual source code, not from human-readable paraphrasing. For each validated entity, do a **single targeted search** in `<repo_path>` to find the primary type/class/struct name. Detect the language from file extensions in the repo and search accordingly:

    ```bash
    # Go:
    grep -r "type <YourGuess>" <repo_path> --include="*.go" -l
    # Python:
    grep -r "class <YourGuess>" <repo_path> --include="*.py" -l
    # Rust:
    grep -r "struct <YourGuess>\|impl <YourGuess>" <repo_path> --include="*.rs" -l
    # TypeScript/JavaScript:
    grep -r "class <YourGuess>\|interface <YourGuess>" <repo_path> --include="*.ts" --include="*.js" -l
    ```

    - Use the **actual type name** from source as the entity `name` (e.g., `FlowControlFilter`, not "Gateway Queue")
    - Set `source` to `<relative-path>::<TypeName>` where `<relative-path>` is relative to `repo_path` (e.g., `pkg/epp/handlers/flowcontrol.go::FlowControlFilter`). The validator will check that `<repo_path>/<relative-path>` exists on disk — so the path must resolve to a real file.
    - If multiple types compose one logical entity, pick the primary orchestrating type
    - If you cannot find a matching type after 2-3 searches, use the best name from `campaign.yaml`'s `target_system` description and leave `source` as `null`

    **Scope guard:** This is a naming step, not a research step. Do NOT read function bodies, trace call graphs, or explore the codebase beyond finding the type declaration. Spend at most 1-2 searches per entity.

    **Graph validation (mandatory — must pass before proceeding):** After writing concepts.json, run:
    ```bash
    python scripts/validate_concepts.py ~/.nous/wiki/campaigns/<campaign-name>/concepts.json
    ```
    If the script exits with errors, fix concepts.json and re-run until it passes. Common fixes:
    - "owned by multiple concepts" → remove the parameter from all but its true owner's `parameters` array
    - "orphaned parameter" → add it to the owning concept's `parameters` array
    - "unreachable entity" → either add an `operates_on` reference from a concept, or remove the entity
    - "unknown entity/parameter/concept" → fix the spelling to match exactly
    - "dangling principles" → add the principle ID to the `principles` array of the most relevant entity, concept, or parameter. If no existing node fits, create a new concept that captures the pattern the principle describes.

    Do NOT proceed to step 10b until `validate_concepts.py` exits 0.

    **b) `summaries.json`** — iteration summaries for the detail panel:
    ```json
    {
      "iter-0": {
        "what_was_tried": "<1-2 sentences: experimental setup>",
        "what_was_found": "<1-2 sentences: key result, include CONFIRMED/REFUTED/PARTIALLY_CONFIRMED>",
        "why_it_matters": "<1 sentence: significance for the campaign's evolution>"
      },
      "iter-1": { ... },
      ...
    }
    ```
    Write a summary for EVERY iteration (including baseline). These appear in the side panel when a user clicks an iteration node. Keep concise but informative.

11. **Generate visualization and open**: Only after ALL indexing steps (4-10) are complete, invoke `/visualize-campaign` to generate and open the HTML.

    If `$ARGUMENTS` contained a `::` delimiter (style intent), pass it through:
    - Without style: invoke `/visualize-campaign <campaign-name>`
    - With style: invoke `/visualize-campaign <campaign-name> :: <style intent>`

    The visualization skill handles running the script, applying any style, and opening the browser.
12. **Invoke /index-wiki**: After visualization is generated, invoke `/index-wiki <campaign-name>` to merge this campaign's data into the cross-campaign registry.

13. **Report**: Print all output paths and confirm the visualization opened:
    - `~/.nous/wiki/campaigns/<name>/dead-ends.json`
    - `~/.nous/wiki/campaigns/<name>/frontiers.json`
    - `~/.nous/wiki/campaigns/<name>/interactions.json`
    - `~/.nous/wiki/campaigns/<name>/principles.json`
    - `~/.nous/wiki/campaigns/<name>/llm_metrics.jsonl`
    - `~/.nous/wiki/campaigns/<name>/summary.md`
    - `~/.nous/wiki/campaigns/<name>/concepts.json`
    - `~/.nous/wiki/campaigns/<name>/summaries.json`
    - `~/.nous/wiki/viz/<name>.html`
    - `~/.nous/wiki/registry.json`

## Important Rules

- **Read-only inputs**: Never modify the campaign's own files (ledger.json, principles.json, etc.).
- **Per-campaign isolation**: Each campaign's structured data lives in `~/.nous/wiki/campaigns/<name>/`. No shared markdown files.
- **Idempotent**: If the campaign is already indexed (step 3 check), skip indexing and only regenerate the visualization (steps 11-12).
