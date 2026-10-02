# 03 — Gateway signing step

**Depends on:** 02-sigv4-connection
**Part of:** S3-compatible object storage — see [README](./README.md)

## Context

This slice teaches the controller to render the signing step for a `sigv4` Connection's
Secret: a STREAMING guard plus Envoy's `aws_request_signing` filter, both run only for
requests that name the Connection in their SigV4 `Credential=`. After this slice an agent that
sets the placeholder key ID by hand can use a real bucket. This is the **early IBM check**
from grill decision 10: run it before starting slice 04.

## Implementation plan

All paths are under `packages/controller/pkg/reconciler/`. Envoy is
`distroless-v1.39.1` (`packages/controller/pkg/config/config.go:241`). Check every field name
below against the 1.39 API reference before using it.

1. **Descriptor.** `envoy.go`: extend `connectionHostInjection` (:368-381) with an optional
   `signing {region, service, credentialsKey}`. In `expandConnectionSecret` (:427-484), an
   entry with `signing` becomes a signing credential, not a header injector: validate
   `credentialsKey` for traversal and presence the way `caKey` is (:453, :456), and degrade
   the host to allow-only with a warning when the key is missing, like the SDS check in
   `chainsFromSecrets` (:589-593). Carry it on `envoyCredential` (:64-72) or a sibling type,
   with its own filter name (`FilterName()` :74 hashes header+path, which doesn't fit).
2. **Pod rev.** `sdsDataKeys` (:783-792) counts only `sds.yaml` / `*.sds.yaml`. Include the
   credentials-file key so adding or removing one rolls the gateway like an SDS key does, and
   bump `envoyBootstrapTemplateRev` (:744).
3. **Filters.** `envoy_bootstrap.go` `buildChainHTTPFilters` (:346-395): after the
   injectors and before `dynamicForwardProxyHTTPFilter()`, for each signing credential:
   - a Lua **STREAMING guard**: when `x-amz-content-sha256` starts with `STREAMING-`, respond
     400 with a short plain-text body saying the gateway re-signs requests and the client
     must set `request_checksum_calculation = when_required` (link-free, brand-free);
   - the **`envoy.filters.http.aws_request_signing`** filter: `service_name` and `region` from
     the descriptor, `use_unsigned_payload: true`, `host_rewrite` = `c.HostRewrite()`
     (envoy.go:107; the router's `host_rewrite_literal` runs too late), `match_excluded_headers`
     containing `x-platform-conn` (removed by the vhost after signing, see :317), and a
     credential provider that reads **only** the mounted credentials file
     (`/etc/envoy/credentials/cred-<secret>/<credentialsKey>`, profile `default`) with
     `watched_directory` on the volume root. No env, IMDS or container fallback.
   Wrap **both** in `skippedUnlessAddressed` (`envoy_connection_address.go:284-304`)
   unconditionally, whatever `c.RequireAddress` is.
4. **Address parsing.** `envoy_connection_address.go` `luaConnectionAddressBody`
   (:173-282): at the start of `address_in` (:199), match
   `^AWS4%-HMAC%-SHA256%s+.-Credential=([^/,%s]+)/` and continue with the captured access key
   as `value`. The existing vendor-prefix and `platform:conn:` checks then apply as they are.
   `claimedHeaderNames` (:108-121) needs `authorization` claimed for signing credentials;
   confirm the signing credential feeds it (set `HeaderName: "Authorization"` on it, or
   extend the function).
5. **Rivals.** `RivalsOf` (:25-47) compares header names on overlapping scopes. Signing
   credentials are always address-gated, so they must not make each other, or a header
   injector on the same host, contested. Make sure two `sigv4` Connections on one host do not
   produce a refusal route (`buildUnaddressedRoutes`, envoy_bootstrap.go:444).
6. **Tests** (grill decision 9 asks for these). Extend the existing files with the same
   helpers and style:
   - `envoy_test.go`: a signing Secret renders the guard and signing filter after the
     injectors and before the forward proxy; missing credentials key degrades to allow-only
     (copy `TestChainsFromSecrets_ConnectionMissingSDSKeyDegradesToAllowOnly` :784); traversal
     key ignored (copy :1666); secrets rev changes when the credentials key appears (copy
     :1129).
   - `envoy_connection_routes_test.go`: both filters are skipped unless addressed even when
     `RequireAddress` is false (copy `assertInjectsOnlyWhenAddressed` :470); the Lua script
     reads an address from a SigV4 `Credential=` (next to
     `…ReadsAnAddressBehindAVendorPrefix` :572); two signing Connections on one host get no
     refusal route.

## Acceptance criteria

- [ ] `mise run //packages/controller:check` and `mise run //packages/controller:test` pass
      (the staticcheck Go toolchain mismatch is known and environmental).
- [ ] The rendered bootstrap for a `sigv4` grant contains the guard and signing filter in the
      right place, both gated on the Connection's address, with `host_rewrite`,
      `use_unsigned_payload: true` and the excluded marker header.
- [ ] A host whose credentials key is missing renders as allow-only and the gateway boots.
- [ ] Rotating the credentials file contents does not change the secrets rev (no roll), but
      adding or removing the key does.

## Smoke test

Unit: the two `mise run` commands above. Then the **early IBM check** on the local cluster
(the `cluster-ops` skill covers rebuilding the controller):

1. The user creates the Connection with real IBM COS keys and grants it to an agent.
2. In the agent shell (no slice 04 yet, so set things by hand):
   `uv tool install awscli`, then
   `AWS_ACCESS_KEY_ID=platform:conn:<id> AWS_SECRET_ACCESS_KEY=dummy AWS_REQUEST_CHECKSUM_CALCULATION=when_required aws --endpoint-url https://<endpoint> --region <region> s3 cp ./file s3://<bucket>/x`
   then `s3 ls` and `s3 rm`. All must succeed.
3. Repeat the `cp` without `AWS_REQUEST_CHECKSUM_CALCULATION`: the guard's 400 message shows.
4. Publish an artifact from the same agent: it still works.

If IBM refuses `UNSIGNED-PAYLOAD` in step 2, stop and report. The design goes back to grill
decision 2.
