# 04: Docs: skill and architecture pages

**Depends on:** 03-bridge-request-ui
**Part of:** Artifact API, see [README](./README.md)

## Context

Agents learn how to build interactive artifacts from the `platform-artifacts` skill, and people and
agents learn the system from the architecture pages. Both must describe the Artifact API once the
code exists. The glossary rows are already written on this branch.

## Implementation plan

Follow [documentation guidelines](../../guidelines/documentation-guidelines.md). Plain English,
no ADR references.

1. **Skill, `packages/platform-base/skills/platform-artifacts/SKILL.md`.** Add a section after the
   `sendPrompt` part:
   - What `platform.request({ method, path, body, contentType })` returns and when it rejects
     (`err.reason`), with a short example that GETs JSON and one that POSTs JSON.
   - The server: listen on `127.0.0.1:5555` only (never `0.0.0.0`), start it yourself, for example
     with `nohup ... &`, and check now and then that it still answers, because it stops when the
     agent hibernates. The platform never starts it.
   - The page must handle `app-not-listening` (show "starting" or "ask the agent to start the
     server") and must work for reading when the server is down.
   - Limits: text bodies only, 1 MiB each way, 30 s, 8 requests at once, only `content-type`
     passes through.
   - Same place rules as `sendPrompt`: only in the docked preview of the publishing agent's chat,
     latest version, never on shared pages.
   - Update the skill's `description` frontmatter so it also triggers for "artifact that loads or
     saves data from the agent".
   - Update the `interactive` field description in
     `packages/api-server/src/modules/artifact-library/mcp-tools.ts` so it mentions data requests,
     not only prompt buttons.
2. **`docs/architecture/artifact-library.md`, section *Interactive pages*.** Describe the
   request/response bridge, the rule that the server picks the agent from the artifact, the
   four-hop path, and that the page still never holds credentials. Bump `Last verified:`.
3. **`docs/architecture/agent-lifecycle.md`.** Where the image contract lists the fixed-path
   executables, add that `127.0.0.1:5555` is reserved for the Artifact API, that the platform
   never starts anything there, and that a server there does not keep the agent awake. Bump
   `Last verified:`.
4. **`docs/architecture/platform-topology.md`.** Where it lists what agent-runtime serves on the
   harness port, add the Artifact API relay. State that no port was added to the pod, Service,
   NetworkPolicy or VM runner. Bump `Last verified:`.
5. **Glossary.** Re-read the three rows in `docs/ubiquitous-language.md` (Artifact Bridge,
   Artifact API, Artifact API Port) against what was built, and drop the *(proposed, in design)*
   marker.

## Acceptance criteria

- [ ] The skill has a `platform.request` section with the port, the lifecycle rule, the limits and
      the `app-not-listening` handling.
- [ ] The three architecture pages describe the feature, and each has a fresh `Last verified:`.
- [ ] The glossary rows match the code and are no longer marked proposed.
- [ ] No ADR is referenced; no brand is hardcoded.
- [ ] `mise run check` passes (docs and prettier formatting included).

## Smoke test

1. `mise run check` passes.
2. Run `/doc-drift` on the branch: no drift reported for the files this feature changed.
3. In a fresh agent session, ask the agent to "build an interactive dashboard that loads data from
   a small server you run". Confirm it reads the skill, binds `127.0.0.1:5555`, and the page uses
   `platform.request` and handles `app-not-listening`.
