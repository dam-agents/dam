# 05 — Rotate the key pair

**Depends on:** 02-sigv4-connection
**Part of:** S3-compatible object storage — see [README](./README.md)

## Context

Credentials are updated in place today, but the update contract carries one string. A `sigv4`
Connection rotates two values together: a new HMAC credential has a new access key ID too.
The agent holds only the placeholder, so nothing on the agent side changes. The gateway reads
the credentials file through `watched_directory`, so no pod rolls.

## Implementation plan

Apply **/typescript-engineering** (api-server-api, api-server) and **/react-ui-engineering**
(packages/ui).

1. **Contract.** `packages/api-server-api/src/modules/connections/schemas.ts`:
   `connectionUpdateInputSchema` is `{id, value}` (:9-12), and the service method is
   `update(id, value)` (`types.ts:286`). Make the input carry either the existing single
   `value` or a `sigv4` pair `{accessKeyId, secretAccessKey}` (a discriminated shape, so
   existing callers keep working unchanged), and update the service signature to match.
2. **Service.** `connections-service.ts` `update` (:581-585): replace slice 02's "not supported
   yet" with a `rotateSigv4Keys` next to `rotateHeaderValue` (:235). Re-validate with the
   `S3CredentialProbe` from slice 02 under `rejectIfInvalid` (as `rotateClientSecret` :246
   does), then `putFields` the two key fields and the regenerated credentials file. Endpoint,
   region and bucket do not change. Annotations stay as they are (`putFields` keeps them).
3. **UI.** `components/connection-update-credential-dialog.tsx`: the dialog has one `value`
   field (:57-79). For `sigv4`, render two fields (access key ID, secret key) and send the
   pair. `hooks/use-connection-maintenance.ts:24` now offers "Update credential" for
   `sigv4`, and `forms/field-copy.tsx` `CREDENTIAL_COPY` gets its dialog copy.
4. **CLI.** `packages/cli/src/modules/connection/commands/update.ts` (:12, :74, :89): for a
   `sigv4` Connection, prompt for both values (secret input for the secret key) and send the
   pair.

## Acceptance criteria

- [ ] `mise run check` and `mise run test` pass.
- [ ] Rotating with keys the endpoint refuses fails and leaves the old keys in place.
- [ ] Rotating with valid keys rewrites the Secret's key fields and credentials file; the
      annotations and the Connection's grants are unchanged.
- [ ] Rotating existing header, client-credentials and GitHub App Connections works as before.

## Smoke test

`mise run check` and `mise run test`. On the local cluster with slices 03 and 04 in place, the
user creates a second HMAC credential for the same bucket upstream, then uses "Update
credential" in the UI with it. In the agent, `aws s3 ls s3://<bucket>` keeps working with no
gateway pod restart (`mise run cluster:kubectl -- get pods` shows the same gateway pod age).
Then delete the old HMAC credential upstream and confirm the agent still works.
