# 01 — Split the credential gateway page

**Part of:** S3-compatible object storage — see [README](./README.md)

## Context

[security-and-credentials.md](../../architecture/security-and-credentials.md) is 40,125
characters, over the 40,000 page cap, so any edit fails `check:doc-size` and the write-time
hook. Slice 07 needs to describe the new signing step. Per the documentation guidelines, the fix
is to split the subsystem, not to reword it. The Envoy gateway mechanics are a coherent
subsystem of their own. This slice is a pure move: no behaviour change, no new content.

## Implementation plan

1. Read [documentation-guidelines.md](../../guidelines/documentation-guidelines.md) first.
2. Create `docs/architecture/credential-gateway.md` with `Last verified: <today>` under the
   title. Move into it, as they are, the `## Envoy credential injection` section (from its
   heading up to `## HITL ext_authz`), keeping its sub-parts (L7 promotion, SDS degrade, gateway
   eviction, HTTP/2, non-443 upstreams and streaming, path rewriting, multiple injection steps,
   two connections claiming one header). Add a 2–3 sentence overview at the top saying what
   the gateway does and that the trust model lives on security-and-credentials.
3. In security-and-credentials.md, replace the moved section with a short
   `## Envoy credential injection` paragraph (what it guarantees: credentials exist only
   gateway-side, injected on the wire, route-confusion closed) and a link to the new page. Keep
   the heading so the existing `#envoy-credential-injection` anchor still lands somewhere
   sensible (no repo file links to that anchor today, but external links may). Bump
   `Last verified`.
4. Fix cross-links: any link in the moved text pointing to a heading that stayed on
   security-and-credentials needs the page prefix, and links in the remaining page to moved
   headings need the new page. Grep `docs/` for `security-and-credentials.md#` and check each
   anchor still resolves.
5. Index: [architecture.md](../../architecture.md) is at exactly 8,000 characters, its cap.
   Add the new page as a sub-link on the existing security-and-credentials bullet (the
   pattern the vm-runner bullet uses: "[Mac](...), [image cache](...)"), and shorten that same
   bullet so the file does not grow. Bump its `Last verified`.

## Acceptance criteria

- [ ] `mise run check` passes, including `check:doc-size` for both pages and the index.
- [ ] security-and-credentials.md is at least a few hundred characters under 40,000, so slice
      07 is not blocked by a later small edit elsewhere on that page.
- [ ] Every relative link and anchor in the two pages and the index resolves.
- [ ] The moved text is unchanged apart from link fixes (diff shows a move).

## Smoke test

`mise run check` (doc-size and link checks). Then open both pages in the IDE preview and click
through every link touched in step 4.
