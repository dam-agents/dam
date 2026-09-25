---
name: update-vulnerable-deps
description: >
  Fetch open GitHub issues labeled "vulnerability" and open Dependabot alerts,
  fix all of them, then present to the user for approval before
  committing and opening PRs.
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Agent
  - AskUserQuestion
---

Run in parallel:

```sh
gh issue list --label vulnerability --state open --json number,title,body,labels,url --limit 50
```

```sh
gh api repos/$(gh repo view --json nameWithOwner --jq .nameWithOwner)/dependabot/alerts --method GET \
  -q '[.[] | select(.state=="open")] | sort_by(.security_advisory.severity | if . == "critical" then 0 elif . == "high" then 1 elif . == "medium" then 2 else 3 end)'
```

If both sources return zero items, there is nothing to do, so stop.

Present a numbered summary table to the user, sorted by severity:

| # | Source | Severity | Title | Detail |
|---|--------|----------|-------|--------|

Fix all items. Do not ask the user which ones to fix.

Note: tools are configured to avoid releases younger than 7 days. Add an exclusion if necessary to install a fixed release. Review exclusions and remove ones that according to `git blame` were added more than 7 days ago.

By ecosystem:
- Mise: `mise use tool@version`, use `mise lock` to update `mise.lock`
- Node.js: use `pnpm`, with overrides in top-level `package.json` if necessary
- GitHub Actions: use `pinact`
- Go: fix manually, run `mise -C packages/controller x -- govulncheck ./...` to verify
- Agent images (`mise oci`, see `docs/architecture/agent-images.md`): tools are pinned in `packages/agents/base/base.toml` and each `packages/agents/*/image.toml` (plus `packages/e2e/agents/mock/image.toml`), resolved in `packages/agents/base/image.lock`, with the npm tools' dependency trees in `packages/agents/base/image-locks/<tool>/<version>/aube-lock.yaml`. Bump the pin, then `mise run //packages/agents:oci --lock`; for a `latest` pin, `mise run //packages/agents:oci --lock --bump` (re-resolves every `latest`). A vulnerable npm transitive is fixed by bumping its tool. A workload `pipx:` tool is locked like any other (its Python tree in `image-locks/pipx-<tool>/<version>/uv.lock`) unless it has `uvx_args`: mise cannot lock those, so their `image.toml` pin, `uvx_args` included, is the only pin. `apt.toml` packages are `latest` and rebuilt daily: no action. The image's release-age gate is `packages/agents/base/rootfs/etc/mise/conf.d/settings.toml`.
- Keycloak: the base image's tag+digest in `packages/keycloak-theme/.mise/tasks/oci`. Before bumping, scan the candidate (`mise x --no-deps -- trivy image quay.io/keycloak/keycloak:<tag>`) to confirm it fixes the findings.

## Trivy findings in images

The automated scan issue aggregates Trivy results without file paths. To find which baked tool carries a package, scan the image the issue's run scanned (`quay.io/dam-agents/<component>:<head sha of the run>`):

```sh
mise x --no-deps -- trivy image --quiet --platform linux/amd64 --format json <image> \
  | jq -r '.Results[] | select(.Vulnerabilities) | .Target as $t | .Vulnerabilities[] | "\($t)\t\(.PkgName) \(.InstalledVersion) -> \(.FixedVersion)"' | sort -u
```

In agent images the target is `usr/local/share/mise/installs/<tool>/<version>/…`; a `Python` target with no path is usually a pip-vendored library in mise's Python. Go modules inside third-party binaries (docker's static bundle, buildx, compose, k3s, kubectl) are fixed only by an upstream release: if the tool is already at its latest release, the finding is blocked upstream. Report it as such, do not suppress it.
