Visualize a Nous campaign as an interactive knowledge graph.

## Arguments

`$ARGUMENTS` format: `<campaign-name>` or `<campaign-name> :: <style intent>`

- **Campaign name** (required): The name of an indexed campaign (must exist under `~/.nous/wiki/campaigns/`)
- **Style intent** (optional): Everything after `::`. When present, all visible text in the visualization is restyled to match this tone/style. The canonical wiki data is NOT modified.

Examples:
- `/visualize-campaign epp-ttft-slope-detector`
- `/visualize-campaign epp-ttft-slope-detector :: explain like I'm a novice`
- `/visualize-campaign blis-search-algo2 :: brief and technical, no jargon expansion`

## Steps

1. **Parse arguments**: Split `$ARGUMENTS` on the **first** occurrence of `::` only.
   - Left side (trimmed) = campaign name. If empty, STOP and tell the user: "Please provide a campaign name. Usage: `/visualize-campaign <name>` or `/visualize-campaign <name> :: <style>`"
   - Right side (trimmed, if present) = style intent. Everything after the first `::` is the style, including any subsequent `::` characters. If no `::` in arguments, style = None. If `::` is present but the right side is empty/whitespace after trimming, treat as no style and warn: "Found `::` but no style intent after it. Proceeding without style."

2. **Resolve paths**:
   - `wiki_dir` = `~/.nous/wiki`
   - `campaign_dir` = `~/.nous/wiki/campaigns/<campaign-name>`

3. **Verify data files exist**: Check that ALL of the following exist:
   - `<campaign_dir>/summaries.json`
   - `<campaign_dir>/concepts.json`
   - `<campaign_dir>/dead-ends.json`

   If ANY are missing, **STOP** and tell the user:
   > "This campaign hasn't been fully indexed yet. Run `/post-campaign <path>` first, then re-run `/visualize-campaign`."

   Do NOT proceed. Do NOT attempt to generate or fix any data yourself.

4. **Find the campaign source path**: Look for a directory containing `ledger.json` and `principles.json` that matches the campaign name. Search in:
   - `.nous/<campaign-name>/` relative to the current project
   - `~/Downloads/**/.nous/<campaign-name>/`
   - If not found, ask the user for the campaign source path.

5. **If no style intent** → go directly to step 7.

6. **Restyle text fields** (only when style intent is present):

   **Prepare temp directory**: Delete `/tmp/nous-viz-styled-<campaign-name>/` if it exists, then recreate it fresh. This prevents stale files from prior runs contaminating output.

   Read the canonical files:
   - `<campaign_dir>/concepts.json`
   - `<campaign_dir>/summaries.json`
   - `<campaign_dir>/dead-ends.json`
   - `<campaign_dir>/frontiers.json` (if exists)
   - `<campaign_dir>/interactions.json` (if exists)
   - `<campaign_dir>/summary.md` (if exists)

   Make **5 parallel LLM calls** to restyle text. For each call, use structured output (provide a response schema) so the LLM can ONLY fill in text strings — the structure is locked.

   **Call 1 — Concepts/Entities/Parameters definitions:**

   Prompt:
   ```
   Rewrite each "definition" field to match this style: "<style intent>"

   Keep the name fields exactly as-is. Only rewrite the definition strings.
   Preserve technical accuracy — change tone/vocabulary/depth, not meaning.
   ```

   Response schema (construct from the canonical concepts.json):
   ```json
   {
     "entities": [{"name": "<exact name>", "definition": "string"}],
     "concepts": [{"name": "<exact name>", "definition": "string"}],
     "parameters": [{"name": "<exact name>", "definition": "string"}]
   }
   ```

   Provide the original definitions as context so the LLM knows what to restyle.

   **Call 2 — Iteration summaries:**

   Prompt:
   ```
   Rewrite each narrative field to match this style: "<style intent>"

   Keep iter keys exactly as-is. Only rewrite the three text fields per iteration.
   Preserve technical accuracy.
   ```

   Response schema (construct from canonical summaries.json):
   ```json
   {
     "<iter-key>": {"what_was_tried": "string", "what_was_found": "string", "why_it_matters": "string"}
   }
   ```

   **Call 3 — Dead-ends:**

   Prompt:
   ```
   Rewrite the text fields to match this style: "<style intent>"

   Keep id and iteration fields exactly as-is. Only rewrite title, what_was_tried, why_it_failed, avoid_when.
   ```

   Response schema:
   ```json
   [{"id": "<exact>", "title": "string", "what_was_tried": "string", "why_it_failed": "string", "avoid_when": "string"}]
   ```

   **Call 4 — Frontiers + Interactions:**

   Prompt:
   ```
   Rewrite the text fields to match this style: "<style intent>"

   Keep id and related_principles fields exactly as-is.
   ```

   Response schema for frontiers:
   ```json
   [{"id": "<exact>", "title": "string", "what_was_tried": "string", "what_was_left_untried": "string", "what_to_try_next": "string"}]
   ```

   Response schema for interactions:
   ```json
   [{"id": "<exact>", "title": "string", "approach_a": "string", "approach_b": "string", "why_combine": "string", "experiment_to_run": "string"}]
   ```

   (If either file doesn't exist, skip that part of the call.)

   **Call 5 — Summary.md:**

   Prompt:
   ```
   Rewrite this campaign summary markdown to match this style: "<style intent>"

   Preserve the heading structure (# headings). Change the prose tone/vocabulary/depth.
   ```

   Response: a single markdown string.

   **Merge and write temp files:**

   For each successful call:
   - Deep copy the canonical file
   - Replace only the text fields with the restyled versions (matched by `name` for concepts, by `id` for insights, by key for summaries). If a returned `name` or `id` does not match any entry in the canonical file, skip that entry and keep canonical text.
   - All structural fields (`principles`, `operates_on`, `parent_concept`, `parameters`, `evolution`, `source`, `related_principles`, `iteration`) remain unchanged
   - Write to `/tmp/nous-viz-styled-<campaign-name>/`

   **Assemble `insights.json`**: The script's `--insights` flag expects a single JSON object with keys `dead_ends`, `frontiers`, and `interactions`. After Calls 3 and 4 complete, combine the restyled arrays into:
   ```json
   {
     "dead_ends": [<restyled dead-ends array>],
     "frontiers": [<restyled frontiers array, or empty if file didn't exist>],
     "interactions": [<restyled interactions array, or empty if file didn't exist>]
   }
   ```
   Write this combined object to `/tmp/nous-viz-styled-<campaign-name>/insights.json`.

   **Failure handling:**
   - If a call fails or returns unexpected structure (e.g., array length mismatch, missing fields), use the canonical data for that component. Never partial-restyle within a single file — either fully restyled or fully canonical.
   - Print a visible warning: "WARNING: Could not restyle <component> (<reason>). Showing original text for this section."
   - If ALL 5 restyle calls fail, STOP and ask the user: "All style calls failed. Would you like to open the canonical (unstyled) visualization instead, or retry?"

7. **Run the visualization script**:

   If style was applied (step 6 completed):
   ```bash
   python scripts/visualize_campaign.py "<campaign_source_path>" \
     --concepts /tmp/nous-viz-styled-<campaign-name>/concepts.json \
     --summaries /tmp/nous-viz-styled-<campaign-name>/summaries.json \
     --insights /tmp/nous-viz-styled-<campaign-name>/insights.json \
     --summary-md /tmp/nous-viz-styled-<campaign-name>/summary.md
   ```

   If no style (canonical):
   ```bash
   python scripts/visualize_campaign.py "<campaign_source_path>" \
     --summaries ~/.nous/wiki/campaigns/<campaign-name>/summaries.json \
     --concepts ~/.nous/wiki/campaigns/<campaign-name>/concepts.json
   ```

8. **Open the HTML**:
   ```bash
   open ~/.nous/wiki/viz/<campaign-name>.html
   ```

9. **Report** the output path.

## Important

- This skill does NOT modify any wiki files or registry data.
- Style restyling is ephemeral — it only affects the generated HTML, not the stored JSON.
- If style is present, the 5 LLM calls are independent and can be made in parallel (i.e., as separate tool calls in a single response) for speed.
- If any restyle call fails, that file falls back to canonical text with a visible warning.
- Campaign names must not contain `::`. If a campaign directory name contains double colons, rename it before using this skill.
