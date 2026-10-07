---
name: up
description: >
  Update dependencies across every ecosystem in the repo: npm packages, mise
  tools, Go modules, Rust crates, Python packages, base and runtime images, the
  tools baked into agent images, GitHub Actions, Helm charts and cluster
  add-ons. The full workflow (`all`, also feat, full) fixes known
  vulnerabilities, bumps every direct dependency to its latest release, reads
  the changelogs, migrates, adopts new features where they simplify code or
  harden it, and drops dependencies that are unused or barely used. The
  default `sec` (also security, vuln, cve) runs only the vulnerability steps.
  Presents the result for approval before committing and opening a PR.
  Triggers on "update deps", "bump dependencies", "fix vulnerabilities",
  "dependabot alerts".
argument-hint: "[sec|all]"
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Agent
  - AskUserQuestion
  - WebFetch
  - WebSearch
---

Mode: `$ARGUMENTS`

- **sec-only** (default): empty argument or any word for security (`sec`, `security`, `vuln`, `vulnerable`, `cve`, …). Fixes known vulnerabilities; skips steps marked so.
- **full**: any word for every dependency (`all`, `feat`, `feature`, `full`, …). Runs every step.

Ask with AskUserQuestion only if the word fits neither. Never ask which dependencies to update: handle all.

## Rules

- **Direct dependencies only.** Transitives move when their lockfile refreshes. Never override or resolve a transitive to bump it, except for a known vulnerability: bump the direct dependency pulling it in, and add a `pnpm-workspace.yaml` override only when no release of it fixes it. Remove an override once the direct deps resolve at or above its target without it.
- **7-day release age.** Every ecosystem refuses releases younger than 7 days: pnpm `minimumReleaseAge` (`pnpm-workspace.yaml`), pinact `min_age` (`.pinact.yaml`), the agent images' `minimum_release_age` (`packages/agents/base/rootfs/etc/mise/conf.d/settings.toml`), and `--minimum-release-age 7d` on `mise lock` / `mise upgrade`. Exclude a release only when it fixes a known vulnerability and is too young, with a comment naming the date the exclusion can go; other young releases wait for the next run. Remove exclusions `git blame` shows are older than 7 days. Exceptions: smolvm (`packages/vm-runner/smolvm.pin`) always moves to its newest release, however young, because the runner tracks it closely; the upstream skills track their repo's branch head, which is ours.
- **Keep the pin style.** An exact pin stays exact. `latest` stays `latest` and is re-locked. A release-line pin (`node = "26"`, `go = "1.27"`, `nodejs:26` in a base tag) moves to a new line only as a major bump.
- **Move coupled pins together.** Change one only with its partners:
  - Node: mise `nodejs`, the api-server base `hi/nodejs:<n>`, and the `node_modules_<n>` whiteout in `packages/api-server/.mise/tasks/oci`.
  - Keycloak: `base_image_keycloak`, keycloak-config-cli (`configCliImage` in `helm/values.yaml`, whose tag names the Keycloak line it supports), and keycloakify in `packages/keycloak-theme`.
  - Envoy: `envoyImage` in `helm/values.yaml`, the controller's default in `packages/controller/pkg/config/config.go`, and its tests.
  - Mirrored images: `.mise/tasks/image/mirror` and their pins in `helm/values.yaml` or `.mise/tasks/cluster/install`.
  - mise: `min_version` in `.mise/config.toml` and `version:` in `.github/actions/setup-mise/action.yml`.
  - Go: mise `go` and the `toolchain` line in `packages/controller/go.mod`. Raise its `go` directive only when a dependency requires it.
  - k3s and Gateway API: `GATEWAY_API_VERSION` in `.mise/tasks/cluster/install` is exactly the bundle k3s's `gateway-api-crd` chart ships for `INSTALL_K3S_VERSION`, never newer (the comment above the pin says why).
- **Always through mise**: `mise run` for tasks, `mise x -- <tool>` for a one-off command.
- **Never skip or disable a test** to make a bump pass.

## Ecosystems

| Ecosystem | Pinned in | Find outdated (step 4) | Find vulnerable (step 1) | Bump |
|---|---|---|---|---|
| Repo toolchain (mise) | `.mise/config.toml` `[tools]` and `min_version`, resolved in `mise.lock` | `mise outdated --bump --json` | Dependabot, Trivy | Edit the pin, then `mise lock --minimum-release-age 7d`. `mise lock --bump` re-resolves `latest` pins. |
| npm | every workspace `package.json` (`pnpm-workspace.yaml` lists them); `pnpm-lock.yaml` | `mise x -- pnpm outdated -r --format json` | Dependabot, `mise x -- pnpm audit` | `mise x -- pnpm update -r --latest <pkg>…` |
| Go | `packages/controller/go.mod` | `mise x -- go list -m -u -json all` in `packages/controller`; keep entries that are not `Indirect` and have an `Update` | `mise -C packages/controller x -- govulncheck ./...` | `go get <mod>@<ver>`, then `go mod tidy` |
| Rust | `packages/vm-runner/Cargo.toml`, `packages/vm-runner/platform-init/Cargo.toml`; `packages/vm-runner/Cargo.lock` | `mise x -- cargo info <crate>` for each `[dependencies]` entry | `mise x -- cargo audit --file packages/vm-runner/Cargo.lock` | Edit `Cargo.toml`, then `cargo update -p <crate>` |
| smolvm | `packages/vm-runner/smolvm.pin` (tag, commit, one sha256 per platform) | its GitHub releases, newest one, with no age floor | its release notes | Rewrite every line from the release and its `checksums.sha256`. Then check whether the crane override in `packages/vm-runner/.mise/tasks/oci` can go. |
| crane in the VM runner | `crane_version` and per-arch `crane_sha` in `packages/vm-runner/.mise/tasks/oci` | go-containerregistry releases | Trivy | Version plus both release tarball digests |
| Python | `packages/driver-sdk-py/pyproject.toml`; its `uv.lock` | `mise x -- uv tree --outdated --depth 1` there | Dependabot | Edit the bound, then `mise x -- uv lock --upgrade-package <pkg>` |
| Base images | `base_image_*` in `.mise/config.toml` `[vars]` | the registry's tags (`mise x -- crane ls <repo>`) | the nightly "Base image pins are behind" issue, Trivy | The image:pack bases (controller, ui, api-server, keycloak) are pinned by tag and digest: a new tag is edited by hand, then `mise run image:bump-bases` pins its digest; a digest behind its tag needs `image:bump-bases` alone. `base_image_debian` (agents, vm-runner) is a tag alone: a rebuild picks up its updates. |
| Agent image tools | `packages/agents/base/base.toml`, each `packages/agents/*/image.toml`, `packages/e2e/agents/mock/image.toml`; resolved in `packages/agents/base/image.lock` and `image-locks/` (see `docs/architecture/agent-images.md`) | compare each pin to its registry | Trivy | Edit the pin, then `mise run //packages/agents:oci --lock`. `--lock --bump` re-resolves every `latest`. A vulnerable npm transitive is fixed by bumping its tool. A `pipx:` tool with `uvx_args` is pinned only in its `image.toml`, `uvx_args` included. A k-search source tree is pinned by commit and checksum. `base/apt.txt` is unpinned and rebuilt daily: nothing to do. |
| Runtime images | `helm/values.yaml` (`image:`, `repository:`/`tag:`, `jobImage`, `envoyImage`, `configCliImage`); `.mise/tasks/cluster/install`; `.mise/tasks/image/mirror` | each image's registry or releases | Trivy | Edit the tag. A digest pin (the device plugin) moves with its tag. A mirrored image lands on quay once `image:mirror` runs in CI. |
| Helm chart deps | `helm/Chart.yaml` `dependencies`; `helm/Chart.lock` | the chart repo's index | upstream advisories | Edit the version, then `mise x -- helm dependency update helm` to re-lock it. The `helm/` deps provider only builds from `Chart.lock`. |
| Cluster add-ons | `ISTIO_VERSION`, `CERT_MANAGER_VERSION`, `GATEWAY_API_VERSION` and the ClickStack operator chart in `.mise/tasks/cluster/install`; `INSTALL_K3S_VERSION` in `etc/lima/k3s.yaml` and `etc/lima/k3s-test.yaml` | upstream releases | upstream advisories | Edit the version |
| Upstream skills | `.agents/upstream-skills.json` (repo, tracked `ref`, `commit`, file hashes) | `git ls-remote <repo> <ref>` differs from `commit` | — | `mise run skills:update`. Never edit the vendored skill directories by hand: `check:upstream-skills` fails on any local change. |
| GitHub Actions | `uses:` in `.github/workflows/*.yml` and `.github/actions/*/action.yml`; `.pinact.yaml` | `mise x -- pinact run --check -u` | Dependabot, the nightly security issue | `mise x -- pinact run -u` |

## Workflow


### 1. Collect the vulnerabilities

CI owns the `vulnerability` issues: `security.yml` keeps "Security vulnerabilities (automated scan)" (Trivy on every image, govulncheck, cargo audit, pnpm audit, Mend SCA), the nightly run keeps "Base image pins are behind (automated)". Each is rewritten every scan and closed by the first clean one. Never close or edit them by hand.

Don't read the scan issue's table: it has one row per finding *per image* (a CVE repeats for every agent image on `claude-code`) and is truncated at GitHub's size limit. Read the findings artifacts of the run it links instead (kept one day):

```sh
gh issue list --label vulnerability --state open --json number,title,url
run=$(gh issue view <scan issue> --json body -q .body | grep -oE 'actions/runs/[0-9]+' | head -1 | cut -d/ -f3)
gh run download "$run" -p 'findings-*' -D <scratch dir>
jq -s 'add | group_by([.id, .pkg]) | map(.[0] + {scope: (map(.scope) | unique | join(", "))})' <scratch dir>/*/findings.json
```

One row per finding; `scope` lists every image or scanner it appears in. Artifacts expired → run each ecosystem's "Find vulnerable" command, and the [Trivy command](#trivy-findings-in-images) on each image the issue names.

In parallel, fetch the open Dependabot alerts:

```sh
gh api --paginate 'repos/{owner}/{repo}/dependabot/alerts?state=open&per_page=100' \
  -q '.[] | {number, severity: .security_advisory.severity, ecosystem: .dependency.package.ecosystem, package: .dependency.package.name, manifest: .dependency.manifest_path, fixed: .security_vulnerability.first_patched_version.identifier, summary: .security_advisory.summary}'
```

No findings and no alerts → skip to step 4 (sec-only: stop).

### 2. Group them by fix

Group by the pin that fixes them, not by CVE:

- A finding in every agent image (`bob, claude-code, codex, …`) lives in what they share: `packages/agents/base` or the `claude-code` image the workloads build on. Fix it there once.
- A Trivy `Fixed in` lists one fixed version per release line (`5.0.10, 3.0.7, 2.1.5`). Take the one on the installed line.
- A Mend SCA row names a tarball (`deepmerge-4.3.1.tgz`) and often has no fix version (`—`). Find who pulls it in with `mise x -- pnpm why -r <package>`, and the fixed version in the advisory the row links.
- A Go module, npm package or Python library inside a baked tool's binary or tree is fixed by bumping that tool. Find the tool with the [Trivy command](#trivy-findings-in-images).

Show a numbered table, one row per fix, by severity (critical → low):

| # | Severity | Fix (dependency → version) | Pinned in | Findings it fixes | Images / sources |
|---|---|---|---|---|---|

### 3. Fix the vulnerabilities

For each fix, first check whether the dependency can be dropped (step 7), which fixes the finding for good. Otherwise apply the ecosystem's Bump column at the lowest fixing release. A fix that is a minor or major bump gets the changelog review of step 6. Before bumping Keycloak, scan the candidate (`mise x --no-deps -- trivy image quay.io/keycloak/keycloak:<tag>`) to confirm it fixes the findings.

A finding only an upstream release can fix, with the tool already at latest, is blocked upstream: report it, don't suppress it. While any stays blocked, the scan issue keeps its `blocked-upstream` label.

#### Trivy findings in images

The scan issue aggregates Trivy results without file paths. To find which baked tool carries a package, scan the image the run scanned: `quay.io/dam-agents/<component>:<sha>`, with the sha from `gh run view "$run" --json headSha -q .headSha`. A third-party image is scanned by its own ref (`mise run image:resolve -- list-third-party`).

```sh
mise x --no-deps -- trivy image --quiet --platform linux/amd64 --format json <image> \
  | jq -r '.Results[] | select(.Vulnerabilities) | .Target as $t | .Vulnerabilities[] | "\($t)\t\(.PkgName) \(.InstalledVersion) -> \(.FixedVersion)"' | sort -u
```

In agent images the target is `usr/local/share/mise/installs/<tool>/<version>/…`. A `Python` target with no path is usually a pip-vendored library in mise's Python. Go modules inside third-party binaries (docker's static bundle, buildx, compose, k3s, kubectl) are fixed only by an upstream release of that tool.

### 4. Inventory

**Skip in sec-only mode.**

Collect each ecosystem's outdated set with its "Find outdated" column (step 3's fixes count as done), one parallel Agent per ecosystem, each reporting rows of `ecosystem | dependency | pinned in | current | latest (≥7 days old) | patch/minor/major`. For a `0.x` version, a minor bump counts as a major.

After the edits, find pins the table doesn't cover: `git grep -nE '(version|VERSION|_version)[ =:]+"?v?[0-9]+\.[0-9]'` and `git grep -nE '[a-z0-9.-]+\.[a-z]+/[a-z0-9/._-]+:[A-Za-z0-9._-]+'` outside tests and lockfiles.

Show the inventory sorted major, minor, patch.

### 5. Patch bumps

**Skip in sec-only mode.**

Apply them all, ecosystem by ecosystem (each becomes one commit in step 9). Run the affected packages' checks and tests. A patch that breaks a check is handled like a major bump (step 6).

### 6. Minor and major bumps

**Skip in sec-only mode**, except for the vulnerability fixes step 3 sends here.

One dependency at a time; research may run in parallel Agents, edits to a shared lockfile run sequentially.

1. **Read every changelog entry from current to target**, intermediate versions included, in this order: the migration or upgrade guide, then the GitHub release notes (`gh release view <tag> -R <owner/repo>`), then `CHANGELOG.md`. List every breaking change, deprecation, and new feature.
2. **Check each breaking change against our code**: grep every API, flag, config key or behavior it names; mark it *hits us* (`file:line`) or *does not* (reason). A deprecation that hits us is migrated now.
3. **Migrate.** Apply the upgrade guide's steps and codemods. Regenerate generated files with the repo's own tooling, not by hand: `controller-gen` output, drizzle migrations, generated types, lockfiles. Update the architecture page (and its `Last verified:` date) of any subsystem whose behavior changes.
4. **Adopt new features, but only where they:** (Skip in sec-only mode.)
   - **simplify our code**: they replace a workaround, polyfill, shim, or hand-rolled helper that the dependency now provides;
   - **drop a dependency**: they make another package, tool, or image redundant, so remove it;
   - **make code more secure**: safer defaults, hardening options, or a supported replacement for an insecure pattern we use.

   Candidates: comments waiting on upstream, `git grep -niE 'upstream|workaround|until .* (ships|releases|supports)|drop this once|as of [0-9]'` (e.g. the VM runner replaces smolvm's bundled crane until a smolvm release ships a current one). Never adopt a feature just because it's new. Each adoption becomes its own `refactor`, `perf` or `fix` commit (step 9), so it reverts alone.
5. **Verify** with the affected packages' `mise run //packages/<pkg>:check` and, where the package has one, `:test`.

Ask with AskUserQuestion only when a migration needs a design decision (a framework's new model changes our architecture, two migration paths trade off differently); otherwise don't stop.

### 7. Drop dependencies

**Skip in sec-only mode**, except for the vulnerable dependencies step 3 checks.

The best update is a removed dependency. Review every direct dependency, not just this run's bumps, starting with those that recur in the scan issue or whose tree carries most findings.

**Unused.** Tools first; their output is candidates, not a verdict:

- npm: `mise x -- knip --dependencies --no-progress` at the repo root covers every workspace. It also reports unlisted dependencies and binaries: list those or drop the use.
- Rust: `mise x -- cargo-shear` in `packages/vm-runner`, which needs the smolvm clone.
- Go: `mise x -- go mod tidy` in `packages/controller`, then `git diff go.mod`.
- Python: `driver-sdk-py` has no runtime dependencies. Grep its dev group.

Grep each candidate before removing it: the tools read only source imports and miss dependencies used from `.mise/` tasks and their `#MISE`/`#USAGE` headers, shell scripts, image build tasks, `package.json` scripts, config files that load a plugin by name (ESLint, Prettier, Vite), dynamic `import()`, and peer dependencies another package needs (keycloakify needs `react`) (knip reports `tsx`, `grpc-tools` and `ts-proto` unused, but mise tasks call them). Grep also covers what no tool reads: the mise tools in `.mise/config.toml`, the agent images' tools (grep for each command), and the runtime images.

**Used, but trivially.** List each direct dependency's use sites (`git grep -nE "from ['\"]<pkg>['\"/]|require\(['\"]<pkg>"`, Go `import` blocks, Rust `use <crate>`); read the sites of each with only a few, and decide whether it is:

- **covered by the platform**: the runtime or standard library now does it. Examples: Node's `fetch`, `node:test`, `util.parseArgs`, `util.styleText`, `fs.glob` and `structuredClone`; Go's `slices`, `maps`, `log/slog` and `errors.Join`; a mise tool where an image downloads its own copy.
- **covered by another dependency**: two dependencies do the same job (two date, schema, HTTP or test libraries). Keep the one the code uses most.
- **too big for its use**: one or two calls, a constant or a type from a package that brings a large transitive tree, a native build, or a postinstall script. Write those few lines in our code.

Site count is no verdict: one call into a parser or crypto library is not trivial use. Read the code.

Each removal becomes its own `refactor(deps): drop <dependency>` commit (step 9). A removal that changes behavior or needs more than a small helper goes to the user with AskUserQuestion.

### 8. Verify

- `mise run check` and `mise run test`, plus `mise run check:comment-types`.
- Every image whose inputs changed builds. For the image:pack images and the VM runner: `mise run //packages/<pkg>:oci` (keycloak's package is `keycloak-theme`). For the agent images: `mise run //packages/agents:oci -- <agent>`.
- After a major bump of anything the cluster runs (Kubernetes, the mesh, cert-manager, Keycloak, Postgres, Envoy, the controller's client libraries), run the e2e suite. Use the `cluster-ops` skill, and the `ccweb` skill in a Claude Code on the web sandbox.
- For every vulnerability fix, rerun the finding's "Find vulnerable" command and confirm it is gone.
- Run the `doc-drift` skill over the diff.

A bump that can't land is reverted and goes on the blocked list with its reason: its migration is too large for this run (file an issue with the `file-issue` skill after approval), a peer dependency is not ready, the fix is blocked upstream, the release is too young and fixes no known vulnerability, or it regresses a check that has no fix yet.

### 9. Present, then commit

Show the user:

| Ecosystem | Dependency | From | To (or dropped) | Kind | Fixes | Breaking changes that hit us | Migration done | Features adopted |
|---|---|---|---|---|---|---|---|---|

plus the blocked list with reasons. Wait for approval, then commit on a `chore/up-<YYYY-MM-DD>` branch (`chore/up-sec-<YYYY-MM-DD>` in sec-only mode) with `git commit -s`, using Conventional Commits:
- one `fix(deps): …` commit per ecosystem for its vulnerability fixes, naming the advisories it fixes;
- one `build(deps): …` commit per ecosystem for its patch and minor bumps;
- one commit per major bump, together with its migration;
- one commit per adopted feature;
- one `refactor(deps): drop <dependency>` commit per removed dependency.

Open one PR with the `pr-open` skill, its body the table and the blocked list, referencing the scan issues with `Refs #N`, not `Closes`: CI closes them once a scan of `main` is clean.
