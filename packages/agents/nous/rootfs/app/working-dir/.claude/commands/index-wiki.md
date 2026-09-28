Merge a single campaign's extracted knowledge into the cross-campaign registry.

## Usage

`/index-wiki <campaign-name>` — indexes one campaign into registry.json

## Steps

1. **Resolve campaign**: Use `$ARGUMENTS` as the campaign name. Verify `~/.nous/wiki/campaigns/<campaign-name>/concepts.json` exists.

2. **Read per-campaign files**: From `~/.nous/wiki/campaigns/<campaign-name>/`:
   - `concepts.json` — contains `repo_path`, `system_name`, `research_question`, `campaign_name`, `date`, plus `entities`, `concepts`, `parameters`
   - `principles.json` — full principle definitions (extract IDs for the registry)
   - `dead-ends.json` — refuted approaches
   - `frontiers.json` — boundary conditions
   - `interactions.json` — untested combinations

3. **Load existing registry**: Read `~/.nous/wiki/registry.json`. If it doesn't exist, initialize:
   ```json
   {"version": 1, "projects": {}}
   ```

4. **Idempotency check**: Look for this campaign in `projects[repo_path].campaigns[]` by name. If already present, report "Campaign already in registry — skipping" and stop.

5. **Find or create project**: Look up `projects[repo_path]`. If not present, create:
   ```json
   {
     "name": "<system_name from concepts.json>",
     "campaigns": [],
     "entities": []
   }
   ```

6. **Process entities**: For each entity in `concepts.json`:
   - Normalize the name (lowercase, strip content in parentheses) for matching
   - Check if an entity with the same normalized name exists in `projects[repo_path].entities[]`
     - If yes: add this campaign name to its `campaigns[]` array (if not already there)
     - If no: assign new ID `E-{max_entity_id + 1}`, create entry:
       ```json
       {"id": "E-N", "name": "<entity name>", "aliases": [], "campaigns": ["<campaign-name>"]}
       ```
   - Track the max entity ID across all projects globally (IDs are globally unique)

7. **Build campaign object**: Create the campaign entry for the registry:
   ```json
   {
     "name": "<campaign_name>",
     "date": "<date>",
     "research_question": "<research_question>",
     "concepts": [],
     "parameters": [],
     "principles": [],
     "dead_ends": [],
     "frontiers": [],
     "interactions": []
   }
   ```

   - **Concepts**: For each concept in `concepts.json`, assign ID `C-{max+1}` and add `{"id": "C-N", "name": "<concept name>"}` to the campaign's `concepts[]`
   - **Parameters**: For each parameter in `concepts.json`, assign ID `P-{max+1}` and add `{"id": "P-N", "name": "<parameter name>"}` to the campaign's `parameters[]`
   - **Principles**: Read `principles.json`, add each principle's ID string (e.g., "RP-1") to the campaign's `principles[]` array
   - **Dead-ends**: For each entry in `dead-ends.json`, assign ID `DE-{max+1}` and add `{"id": "DE-N", "title": "<title>"}` to the campaign's `dead_ends[]`
   - **Frontiers**: For each entry in `frontiers.json`, assign ID `F-{max+1}` and add `{"id": "F-N", "title": "<title>"}` to the campaign's `frontiers[]`
   - **Interactions**: For each entry in `interactions.json`, assign ID `I-{max+1}` and add `{"id": "I-N", "title": "<title>"}` to the campaign's `interactions[]`

8. **Add campaign to project**: Append the campaign object to `projects[repo_path].campaigns[]`.

9. **Recompute entity clusters**: Using ALL entities in `projects[repo_path].entities[]` and their definitions from per-campaign `concepts.json` files:

   a. For each entity, gather its definition from the campaign(s) that define it (read `~/.nous/wiki/campaigns/<campaign>/concepts.json` → `entities[]` → match by name). If an entity appears in multiple campaigns, concatenate definitions with ` | `.

   b. Semantically group entities by functional role/purpose into clusters. Rules:
      - Min 2 entities per cluster, max 10
      - Max 20 clusters total per project — if grouping would exceed 20, merge the smallest/most-similar clusters
      - Each entity belongs to at most one cluster (singletons are valid — omit them)
      - Labels: 2-4 words, Title Case, describe the functional group

   c. Assign sequential IDs `EC-1`, `EC-2`, etc. Set `projects[repo_path].entity_clusters` to:
      ```json
      [{"id": "EC-1", "label": "...", "entities": ["E-4", "E-5", "E-6"]}, ...]
      ```

   d. **CRITICAL**: This step ONLY writes the `entity_clusters` field. Do NOT modify `name`, `campaigns`, `entities`, or any other field on the project or registry.

10. **Write registry.json**: Write the updated registry to `~/.nous/wiki/registry.json` with 2-space indentation.

11. **Report**: Print the registry path and a summary of what was added (counts of entities, concepts, parameters, principles, dead-ends, frontiers, interactions).

## ID Assignment Rules

- IDs are **globally unique** across all projects and campaigns
- To find the next ID for a type (e.g., "C-"), scan ALL projects and campaigns in the registry for the maximum existing ID of that type, then increment
- Entity IDs (E-N) are unique per-project in practice but globally unique in assignment
- Principle IDs (RP-N) are NOT reassigned — they keep their original campaign-local IDs

## Deduplication Rules

- **Entities**: Match by normalized name (lowercase, strip parenthetical suffixes). If matched, add campaign to existing entity's `campaigns[]` array.
- **Everything else** (concepts, parameters, dead-ends, frontiers, interactions): Always create new entries. Different campaigns may have similar-sounding entries that are contextually distinct. Never deduplicate these across campaigns.

## Important Rules

- This skill only reads from `~/.nous/wiki/campaigns/` — it never reaches back to source repos
- This is the ONLY skill that writes to `registry.json`
- All metadata (`repo_path`, `system_name`, `research_question`) comes from the per-campaign `concepts.json`, which was populated by `/post-campaign` from the source `campaign.yaml`
- Process one campaign at a time (read registry → modify → write) to prevent conflicts
- `entity_clusters` is the ONLY registry field that is recomputed (not appended). It is fully replaced each time a new campaign is indexed. All other data is strictly append-only.
