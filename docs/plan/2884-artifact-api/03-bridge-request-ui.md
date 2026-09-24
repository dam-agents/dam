# 03: Bridge `platform.request` in shim and host UI

**Depends on:** 02-api-server-call-agent-api
**Part of:** Artifact API, see [README](./README.md)

## Context

This slice gives the page its API and connects it to slice 02. The bridge shim that the renderer
injects into interactive artifacts gets a `request()` function that talks to the host over
postMessage. The host UI checks the message, calls `artifactLibrary.callAgentApi` with the user's
session, and posts the answer back. The UI gate is the same one `sendPrompt` uses today.

## Implementation plan

Apply `/typescript-engineering` for the shim and contract, `/react-ui-engineering` for
`packages/ui`.

1. **Message schemas, `packages/api-server-api/src/modules/artifact-library/prompt.ts`.** Next to
   `ARTIFACT_PROMPT_TYPE`, add `ARTIFACT_REQUEST_TYPE = "artifact.request"`,
   `ARTIFACT_RESPONSE_TYPE = "artifact.response"`, `ARTIFACT_REQUEST_MAX_IN_FLIGHT = 8`,
   `artifactRequestMessageSchema` `{ type, id: string (short, bounded), method, path, body?,
   contentType? }` (reuse the method/path/body rules from slice 02) and the response message type
   (`ok: true` with status/contentType/body, or `ok: false` with `reason`). Export them from
   `src/index.ts`.
2. **Shim, `packages/api-server/src/modules/artifact-library/viewer/bridge-shim.ts`.** Extend the
   frozen `window.platform` object with `request({ method, path, body, contentType })`:
   - Validate the same basics as the schema (method in the list, path starts with `/`, body is a
     string if given) and throw synchronously on bad input, as `sendPrompt` does.
   - Make an id from a counter plus `Math.random()`. Do not rely on `crypto.randomUUID`; the frame
     has an opaque origin and may not be a secure context.
   - Keep a map of pending ids to `{ resolve, reject }`. Post
     `{ type: "artifact.request", id, ... }` to `window.parent` with target `"*"`.
   - One `message` listener: accept only `event.source === window.parent` and
     `type === "artifact.response"` with a known id. `ok: true` resolves
     `{ status, contentType, body }`; `ok: false` rejects with an `Error` whose `reason` property is
     set.
   - No client-side timeout beyond the platform's own; the host always answers.
   - Keep the shim small; it is inlined into every interactive artifact.
3. **Host hook, `packages/ui/src/modules/artifacts/hooks/use-artifact-request.ts`.** Model it on
   `use-artifact-prompt.ts` and `lib/artifact-prompt.ts`:
   - Add a pure reader `readArtifactRequest(event, pageWindow)` in
     `lib/artifact-request.ts`: returns the parsed message only when `event.source` is the frame's
     `contentWindow` and the schema passes.
   - The hook takes the frame ref and `artifactId: string | undefined`. When `undefined`, it
     installs no listener.
   - It keeps an in-flight counter. Over `ARTIFACT_REQUEST_MAX_IN_FLIGHT`, it answers
     `too-many-requests` without calling the server.
   - Otherwise it calls a new `useCallAgentApi` mutation from `api/mutations.ts` and posts
     `{ type: "artifact.response", id, ...result }` to `frame.current.contentWindow` with target
     `"*"`. A thrown tRPC error (e.g. network) is answered as `agent-unreachable`. The hook never
     shows a toast; the page owns its own error display.
   - Drop answers when the frame has been replaced or unmounted (compare `contentWindow` at reply
     time).
4. **Wiring.** In `components/deferred-frame.tsx` add an optional `agentApiArtifactId` prop and call
   `useArtifactRequest(frameRef, agentApiArtifactId)`. In
   `components/docked-artifact-panel.tsx` pass `artifact.id` exactly when
   `canSendArtifactPrompt(artifact, enabled, agentId, shownVersion)` is true (same gate: flag on,
   private, interactive, html, the chat's agent is the publisher, latest version). Consider renaming
   `canSendArtifactPrompt` to `canUseArtifactBridge` since it now gates both; update its callers.
   No other `DeferredFrame` caller (library preview, file preview, experiments) passes the prop.

## Acceptance criteria

- [x] An interactive artifact in the docked preview of its publishing agent's chat, latest
      version, flag on: `await platform.request({ method: "GET", path: "/" })` resolves with the
      server's status, content type and body.
- [x] Non-2xx server answers resolve; platform failures reject with `err.reason` set to one of the
      README reasons.
- [x] The same artifact in the library view, a history version, another agent's chat, or with the
      flag off: `request` rejects or never gets an answer, and no `callAgentApi` call is made (check
      the network tab).
- [x] A 9th concurrent request rejects with `too-many-requests`.
- [x] Messages from any window other than the preview frame are ignored.
- [x] `sendPrompt` still works as before.
- [x] `mise run //packages/ui:check`, `mise run //packages/ui:test`,
      `mise run //packages/api-server:check` and `mise run check:comment-types` pass.

## Smoke test

1. `mise run //packages/ui:test` and `mise run //packages/api-server:test` (existing suites green,
   including the current `sendPrompt` bridge tests).
2. Run the README's whole-feature smoke test steps 2 to 6 on the dev cluster after
   `cluster:build-ui` (hard reload the tab so the new JS chunk loads).
