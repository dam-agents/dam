# 07 — Architecture docs

**Depends on:** 01-split-gateway-page, 03-gateway-signing, 04-aws-profiles, 05-rotate-key-pair
**Part of:** S3-compatible object storage — see [README](./README.md)

## Context

The feature changes behaviour on two architecture pages and adds two domain terms. The drift
rule says behaviour changes update their page in the same PR. This slice writes them once the
behaviour is final.

## Implementation plan

Follow [documentation-guidelines.md](../../guidelines/documentation-guidelines.md): durable,
architecture-level, no field names or file paths, one owner per concept, bump
`Last verified`, Mermaid only, never link ADRs. Use `/doc-drift` at the end against the
branch diff.

1. **`docs/architecture/credential-gateway.md`** (the page slice 01 created) owns the
   mechanics: a request-signing step beside header injection, why it exists (the secret key
   never travels, so it cannot be swapped in), that it runs only for requests naming their
   Connection whatever the Agent's address setting, so foreign and presigned requests pass
   untouched; the plain-body limit (signed chunked uploads cannot be re-signed, so clients are
   pinned to plain bodies and the gateway refuses streaming ones with a readable answer);
   that the signer runs after rewrites in effect (it signs the upstream host), so path-prefix
   addressing does not apply; rotation without a roll.
2. **`docs/architecture/connections.md`**: the `sigv4` auth mode in the Connection section
   (static key pair, validated by use at create and rotation, no expiry); `egress-sign` in the
   Contribution kinds list and the fan-out table; addressing through the access key ID in
   "Addressing a Connection"; a short "S3-compatible storage" example (profiles per
   Connection, active profile follows the preferred grant, no key env); the `platform-s3`
   skill next to `platform-github`. One-liners and a link where the gateway page owns the
   detail.
3. **`docs/architecture/security-and-credentials.md`**: only if the trust model changed. A
   one-liner in "Credential storage" that a key pair is stored and never leaves the gateway,
   linking to the gateway page. Stay under the cap.
4. **`docs/ubiquitous-language.md`**: drop "(proposed, #4024)" from the `sigv4` and
   `egress-sign` entries (:203-204) and correct them to what shipped.
5. **`docs/architecture/runtime-delivery.md`**: if the ini driver's merge behaviour is
   described in "Built-in contribution impls" (:279), make it match the slice 04 fix.

## Acceptance criteria

- [ ] `mise run check` passes, including `check:doc-size` on every touched page and the index.
- [ ] `/doc-drift` against the branch reports no missing page updates.
- [ ] No page names a file path, field name or enum member for the new behaviour.

## Smoke test

`mise run check`. Then read the connections page's S3 example and the gateway page's signing
paragraph cold and check that each answers "why does the agent never see the keys" without
help from code.
