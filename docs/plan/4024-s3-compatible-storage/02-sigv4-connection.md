# 02 — `sigv4` Connection: contract, template, create

**Part of:** S3-compatible object storage — see [README](./README.md)

## Context

This slice makes an "S3-compatible storage" Connection creatable from the UI and CLI. It
stores its keys in the per-Connection Secret in the shape the gateway (slice 03) will read,
grants it to agents, and writes the egress rules. Nothing is signed yet, and the agent gets no
config yet (slice 04). Rotation is slice 05. This slice also adds every exhaustive-switch case
so the branch compiles.

## Implementation plan

Apply **/typescript-engineering** (api-server, api-server-api, agent-runtime-api) and
**/react-ui-engineering** (packages/ui).

**Contract**

1. `packages/api-server-api/src/modules/connections/types.ts`: add `sigv4Auth`
   `{kind: "sigv4", accessKeyIdRef, secretAccessKeyRef, credentialsFileRef, region, service: "s3"}`
   (refs point into the per-Connection Secret; never inline). Add it to `authConfig` (:87)
   and `"sigv4"` to `authKind` (:116).
2. `.../connections/schemas.ts`: add `sigv4CreateInput` beside `headerCreateInput` (:70) and
   join it into `connectionCreateInputSchema` (:158). Inputs: `endpoint`, `region`, optional
   `bucket`, `accessKeyId`, `secretAccessKey`.
3. `packages/agent-runtime-api/src/modules/runtime/types.ts`: add `"egress-sign"` to
   `contributionKind` (:3) and `egressSignContribution`
   `{kind, host, port?, pathPattern?, region, service}` (copy `egressPort` from
   `egress-inject` :77), joined into `contribution` (:118).

**Template and build** (`packages/api-server/src/modules/connections/domain/`)

4. `connection-template.ts`: a `Sigv4ConnectionTemplate` type in the union (:9), and an
   `inputsFor` case (:187): `endpoint` (required, `https://` pattern, label "Endpoint URL"),
   `region` (overridable, preset `us-east-1`, hint "IBM COS accepts any value"), `bucket`
   (optional, hint "Limits the agent to this bucket"), `accessKeyId`, `secretAccessKey`
   (both required, secret).
5. `catalog.ts`: template `s3-compatible`, name "S3-compatible storage", `category: "app"`,
   `isCustom: false`, no family, `iconSlug: "key"` unless you add an SVG. The description says
   in one line that the agent can do whatever these keys allow, so use a read-only key for
   read-only access. `buildCatalog` already validates contributions against the contract.
6. `build-connection.ts`: a `sigv4` case in `buildConnection` (:57) calling a new
   `buildSigv4`. Parse the endpoint: `https://` only, refuse IP literals (same reason as
   `buildKubernetesContributions` in `kubernetes-contributions.ts:36`), drop `:443`, keep any
   other port. Emit one `egress-sign` for the host, path-scoped to the bucket when one is
   given. Check how egress-rule path patterns match: if one pattern cannot cover both
   `/<bucket>` and `/<bucket>/*`, emit one contribution per pattern. Add `egress-sign` to
   `substituteHostInContribution` (:193) and `hasHostContrib` (:383, :544). Secret fields:
   `accessKeyId`, `secretAccessKey`, and the credentials file
   (`[default]` with `aws_access_key_id` / `aws_secret_access_key`) under one data key (name it
   so slice 03 can find it via the descriptor, e.g. `aws-credentials`).
7. `connection-sds.ts`: `connectionSecretAnnotations` (:58) writes an `injection-hosts` entry
   for each `egress-sign`: `{host, port, pathPattern, signing: {region, service, credentialsKey}}`.
   `buildConnectionSdsFields` (:37) writes no SDS for it. Annotations are fixed at create
   (`k8s-secret-store.ts:84-98` keeps them on `putFields`), so the entry must be complete
   here.

**Create flow** (`packages/api-server/src/modules/connections/services/connections-service.ts`)

8. Validation before persist, like the mint branches (:909, :942): a new domain port
   (e.g. `S3CredentialProbe`) with an infrastructure adapter on `@aws-sdk/client-s3` (already
   a dependency; see `artifacts/infrastructure/s3-artifact-store.ts`). Force path style, set the
   region, `requestChecksumCalculation: "WHEN_REQUIRED"`. `HeadBucket` when a bucket is
   given, else `ListBuckets`. Map auth refusals (`InvalidAccessKeyId`,
   `SignatureDoesNotMatch`, 403) to a user error "the endpoint refused these keys", and
   network errors to "could not reach the endpoint". Nothing is persisted on failure. The port
   is a required dependency (no optional or no-op impl).
9. Remaining switch sites: `toView` hosts (:123-132) include `egress-sign`; `update` (:585)
   refuses `sigv4` with a clear "not supported yet" until slice 05; `deleteConnection`
   (:622); `deriveStatus` (:1304) is `active` (static keys, no expiry); `connectionSecretPath`
   (:1331); `SECRET_KEYS` (:1295) gains `accessKeyId` and `secretAccessKey`; the
   `ConnectionCreated` emit (:1031) fires at create. `oauth-refresh.ts` must skip `sigv4`
   (:93-99, :139-143, :201).
10. Rails: `contribution-fanout.ts:47-54` collects `egress-sign` hosts like `egress-inject`, so
    `connectionRulesSync.syncForAgent` writes the allow rows. `capability-filter.ts:22` adds
    `egress-sign` to `HOST_RAIL_KINDS`. `runtime-delivery/domain/contribution-hash.ts:26`
    gets a `keyFor` case. Check `agent-runtime/.../runtime-channel/manifest.ts:145`
    (`KNOWN_KINDS`) tolerates the new kind (it never reaches the runtime).

**UI and CLI**

11. `packages/ui/src/modules/connections/lib/build-create-payload.ts:42` gains a `sigv4` case
    (the `header` case at :90 is the model). `forms/field-copy.tsx`: labels, placeholders and
    hints for the new input names, and a `CREDENTIAL_COPY` entry (:87).
    `hooks/use-connection-maintenance.ts:24`: no "Update credential" action yet (slice 05).
    `agents/lib/contribution-kind-labels.ts:3`: label for `egress-sign`.
    `lib/catalog-providers.ts:189`: the row subtitle shows the host.
12. CLI: `packages/cli/src/modules/connection/commands/connect.ts:465` (`buildPayload`),
    `update.ts:12,74,89` and `reauth.ts:83` handle `sigv4` (connect works; update and reauth
    say "not supported yet" until slice 05).

## Acceptance criteria

- [ ] `mise run check` and `mise run test` pass.
- [ ] Creating a Connection with keys the endpoint refuses fails with the user error and leaves
      no Secret and no row.
- [ ] Creating one with valid keys gives a Secret whose `injection-hosts` annotation carries
      the signing entry and whose data keys include the credentials file. No secret value
      appears in the Connection view, logs or `inputs`.
- [ ] Granting it to an agent writes an `egress_rules` allow row (`source = connection:<id>`)
      for the host, path-scoped when a bucket is set.
- [ ] `http://` and IP-literal endpoints are refused with a readable message.

## Smoke test

`mise run check` and `mise run test`. Then on the local cluster (`mise run cluster:build-ui`
and the api-server build per the `cluster-ops` skill), the user creates an "S3-compatible
storage" Connection with a real bucket's keys: once with a wrong secret (refused), once right
(created). Grant it to an agent and confirm the Egress rules panel shows the host. Check the
Secret's **annotations and data key names only** (local dev cluster:
`mise run cluster:kubectl -- get secret <name> -o jsonpath='{.metadata.annotations}'` and
`... -o jsonpath='{.data}' | jq 'keys'`). Never print the data values.
