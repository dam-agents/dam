# 06 — e2e: signing and passthrough

**Depends on:** 03-gateway-signing, 04-aws-profiles
**Part of:** S3-compatible object storage — see [README](./README.md)

## Context

Grill decision 9: prove the wiring in CI against the public echo, the same way
`05-injection.spec.ts` proves header injection. No real S3 in CI. Envoy owns the signing maths;
we own which requests get signed, with which key ID, and which pass untouched. **This slice
adds one new spec, the agreed exception to "no new tests".**

## Implementation plan

1. **Connection.** The create-time probe from slice 02 needs a real S3 endpoint, and httpbingo
   is not one. Read how `ensureCustomHeaderConnection`
   (`packages/e2e/playwright/src/lib/connections.ts:50`) creates connections, then choose the
   least invasive way to get an S3 Connection pointed at `httpbingo.org` in the e2e
   environment. Prefer an existing e2e-only switch on the api-server (`E2E_ENABLED`,
   `packages/api-server/src/config.ts:97`) that substitutes the probe adapter, over any
   change to production paths. If no such seam exists, add the adapter switch in the
   api-server composition root, gated on `E2E_ENABLED`, and say so in the PR.
2. **Spec.** `packages/e2e/playwright/src/tests/smoke/<next-number>-s3-signing.spec.ts`,
   modelled on `05-injection.spec.ts`. Register it in `playwright.config.ts` with the right
   project dependencies. Use `api.e2e.performFetch` (GET with headers is enough;
   `e2e/router.ts:65`) against `https://httpbingo.org/headers`:
   - **addressed:** an `Authorization: AWS4-HMAC-SHA256 Credential=platform:conn:<id>/<date>/<region>/s3/aws4_request, SignedHeaders=host;x-amz-date, Signature=<dummy>`
     plus `x-amz-date` comes back with the **sentinel key ID** from the e2e Connection in
     `Credential=` and a signature different from the dummy;
   - **foreign:** the same request with `Credential=AKIAFOREIGN/...` comes back byte-for-byte
     unchanged;
   - **profile:** `expectAgentEnv` shows `AWS_PROFILE` set to the e2e Connection's profile.
3. Grant the Connection to the e2e agent in the existing agent setup step, or in the spec,
   whichever the suite's project chain makes simpler.

## Acceptance criteria

- [ ] The new spec passes on the e2e cluster and is stable over three consecutive runs.
- [ ] Existing smoke specs still pass, especially `05-injection` and `11-egress-path-rules`
      (same host chains).
- [ ] Any e2e-only switch is unreachable when `E2E_ENABLED` is off.

## Smoke test

Run the e2e suite per the `cluster-ops` skill (`e2e:install`, then the playwright run with
`PLATFORM_BASE_URL=localhost:5555` for direct runs). Confirm the new spec and `05-injection`
are green.
