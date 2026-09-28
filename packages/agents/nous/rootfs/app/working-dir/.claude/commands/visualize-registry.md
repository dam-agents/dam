Render the cross-campaign knowledge graph from the Nous wiki registry.

This skill verifies prerequisites and runs `visualize_registry.py` to produce an interactive HTML page showing campaigns, entities, concepts, entity clusters, and heuristic opportunity scores — all computed directly from registry data without any LLM calls.

## Steps

1. **Verify registry exists**: Check that `~/.nous/wiki/registry.json` exists and is non-empty.

   If missing, **STOP** and tell the user:

   > "No registry found. Run `/post-campaign <path>` on at least one campaign first, then re-run `/visualize-registry`."

   Do NOT proceed. Do NOT attempt to generate or fix any data yourself.

2. **Run the visualization script**:
   ```bash
   python scripts/visualize_registry.py
   ```

   The script:
   - Reads `registry.json` and per-campaign wiki files
   - Builds a force-directed graph with campaigns, entities, concepts, and parameters as nodes
   - Computes cross-node edges from explicit relationship fields (operates_on, parent_concept, shared principles)
   - Computes heuristic opportunity scores per entity cluster from frontier/interaction/dead-end counts
   - Renders the Opportunities tab showing per-cluster research potential with copyable `/suggest-next` commands
   - Writes `~/.nous/wiki/viz/registry.html`

3. **Open the HTML**:
   ```bash
   open ~/.nous/wiki/viz/registry.html
   ```

4. **Report** the output path and a brief summary of what's in the graph (number of campaigns, entities, concepts, clusters).

## Important

- This skill does NOT modify registry.json, campaign data, or any existing wiki files.
- The ONLY file this skill writes is `~/.nous/wiki/viz/registry.html` (via the Python script).
- Entity clusters are pre-computed at index time by `/index-wiki` and stored in `registry.json`. The script reads them directly.
- No LLM calls are made. All scoring is heuristic (frontier count, interaction count, recency, dead-end density).
- The Opportunities tab helps users identify where to focus research, then run `/suggest-next` themselves for detailed recommendations.
- If the script fails, report the error output verbatim.
