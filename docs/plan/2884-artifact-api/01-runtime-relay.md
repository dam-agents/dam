# 01: Runtime relay to the Artifact API Port

**Part of:** Artifact API, see [README](./README.md)

## Context

agent-runtime is the only thing the api-server can reach inside an agent (port 8080, pod or
microVM). This slice adds a typed tRPC procedure on the runtime that forwards one request to the
agent's own server on `127.0.0.1:5555` and returns the answer, enforcing the limits in the README.
It has no caller yet; slice 02 adds the api-server side.

## Implementation plan

Apply `/typescript-engineering`.

1. **Contract, `packages/agent-runtime-api`.** Add `src/modules/artifact-api/` following
   `src/modules/kb-publish/`:
   - `schemas.ts`: `ARTIFACT_API_PORT = 5555`, `ARTIFACT_API_MAX_BODY_BYTES = 1024 * 1024`,
     `ARTIFACT_API_TIMEOUT_MS = 30_000`; `artifactApiMethodSchema`
     (`GET | POST | PUT | PATCH | DELETE`); `artifactApiRequestInputSchema`
     `{ method, path, body?, contentType? }` where `path` must start with `/` and must not start
     with `//` (so it can never become a different host), and `body` is a string within the byte
     limit (check UTF-8 byte length, not `.length`); the output as a discriminated union on `ok`:
     `{ ok: true, status, contentType: string | null, body: string }` or
     `{ ok: false, reason: "app-not-listening" | "timeout" | "response-too-large" }`.
   - `types.ts`: `ArtifactApiService { request(input): Promise<output> }`.
   - `router.ts`: `artifactApiRouter` with `request: protectedProcedure.input(...).mutation(...)`.
   - Register it in `src/router.ts` as `artifactApi`, add `artifactApi: ArtifactApiService` to
     `src/context.ts`, and export the schemas/constants/types from `src/index.ts`.
2. **Runtime, `packages/agent-runtime`.** Add `src/modules/artifact-api/compose.ts` exporting
   `composeArtifactApi({ port, fetch })` that returns the `ArtifactApiService`:
   - Build the URL as `http://127.0.0.1:${port}${path}` with a fixed host. Never let `path` choose
     the host.
   - Send only `content-type` (the given one, or `application/json` when there is a body). No other
     headers.
   - Use `AbortSignal.timeout(ARTIFACT_API_TIMEOUT_MS)`; an abort maps to `timeout`.
   - A connection refused (`ECONNREFUSED` in the fetch error's `cause`) maps to
     `app-not-listening`. Treat other connection errors the same way.
   - Read the response body as a stream and stop once it passes the byte limit; that maps to
     `response-too-large`. Decode as UTF-8 text.
   - Return `status`, the response `content-type` (or `null`), and the text body. Do not throw for
     non-2xx statuses.
3. Wire it in `src/server.ts`: compose it next to `kbPublish` with `port: ARTIFACT_API_PORT` and
   add `artifactApi` to `createTrpcContext`.
4. Do not change the pod spec, the Service, NetworkPolicies, or the VM runner. The relay runs
   inside the agent, so it works on both Backends without them.

## Acceptance criteria

- [ ] `appRouter` has `artifactApi.request`, and its input rejects a path that is not `/...` or
      starts with `//`, an unknown method, and a body over 1 MiB.
- [ ] With nothing on 5555, the procedure returns `{ ok: false, reason: "app-not-listening" }`
      and does not throw.
- [ ] With a server on 5555, GET and POST return the server's status, content type and body,
      including a 404 or 500 as `ok: true`.
- [ ] A response body over 1 MiB returns `response-too-large`; a server that never answers returns
      `timeout` after about 30 s.
- [ ] No request header other than `content-type` reaches the server.
- [ ] `mise run //packages/agent-runtime:check`, `mise run //packages/agent-runtime-api:check`
      and `mise run check:comment-types` pass.

## Smoke test

1. `mise run //packages/agent-runtime:check` and `mise run //packages/agent-runtime:test`
   (existing suite stays green).
2. On the dev cluster, rebuild the harness image and restart a test agent. In its terminal:
   ```sh
   curl -s -X POST localhost:8080/api/trpc/artifactApi.request \
     -H 'content-type: application/json' -d '{"method":"GET","path":"/"}'
   ```
   expect `app-not-listening` in the result. Then start
   `nohup python3 -m http.server 5555 --bind 127.0.0.1 >/tmp/a.log 2>&1 &` and repeat: expect
   `ok: true`, `status: 200` and the directory listing HTML as `body`.
