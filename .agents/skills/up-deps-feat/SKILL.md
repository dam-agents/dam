---
name: up-deps-feat
description: >
  Bump every direct dependency to its latest release: npm packages, mise
  tools, Go modules, Rust crates, Python packages, base and runtime images,
  the tools baked into agent images, GitHub Actions, Helm charts and cluster
  add-ons. For minor and major bumps, read the changelog, verify breakage,
  migrate, and adopt new features where they simplify code, drop a dependency,
  or make code more secure. Presents the result to the user for approval before
  committing and opening a PR. Vulnerability fixes are up-deps-sec's.
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

Update every direct dependency in the repo. Do not ask the user which ones.

## Rules

- **Direct dependencies only.** Transitives move when their lockfile is refreshed. Never add an override or resolution to bump a transitive for feature reasons. Do remove a `pnpm-workspace.yaml` override once the bumped direct deps resolve at or above its target without it.
- **7-day release age.** Every ecosystem refuses releases younger than 7 days: pnpm `minimumReleaseAge`, pinact `min_age`, the agent images' `minimum_release_age`, and `--minimum-release-age 7d` on `mise lock` / `mise upgrade`. Unlike up-deps-sec, never add an exclusion. A release that is too young waits for the next run. Remove exclusions that `git blame` shows were added more than 7 days ago.
- **Keep the pin style.** An exact pin stays exact. `latest` stays `latest` and is re-locked. A release-line pin (`node = "24"`, `go = "1.26"`, `nodejs:24` in a base tag) moves to a new line only as a major bump.
- **Move coupled pins together.** Change one only with its partners:
  - Node: mise `nodejs`, the api-server base `hi/nodejs:<n>`, and the `node_modules_<n>` whiteout in `packages/api-server/.mise/tasks/oci`.
  - Keycloak: `base_image_keycloak`, keycloak-config-cli (`configCliImage` in `helm/values.yaml`, whose tag names the Keycloak line it supports), and keycloakify.
  - Envoy: `envoyImage` in `helm/values.yaml`, the controller's default in `packages/controller/pkg/config/config.go`, and its tests.
  - Mirrored images: `.mise/tasks/image/mirror` and their pins in `helm/values.yaml` or `.mise/tasks/cluster/install`.
  - mise: `min_version` in `.mise/config.toml` and `version:` in `.github/actions/setup-mise/action.yml`.
  - Go: mise `go` and the `toolchain` line in `packages/controller/go.mod`. Raise its `go` directive only when a dependency requires it.
- **Always through mise**: `mise run` for tasks, `mise x -- <tool>` for a one-off command. Never call a tool directly.

## 1. Inventory

Collect the outdated set for each ecosystem. The ecosystems are independent, so run them in parallel, one Agent each. Every Agent reports rows of `ecosystem | dependency | pinned in | current | latest (≥7 days old) | patch/minor/major`. For a `0.x` version, a minor bump counts as a major.

| Ecosystem | Pinned in | Find outdated | Bump |
|---|---|---|---|
| Repo toolchain (mise) | `.mise/config.toml` `[tools]` and `min_version`; resolved in `mise.lock` | `mise outdated --bump --json` | Edit the pin, then `mise lock --minimum-release-age 7d`. `mise lock --bump` re-resolves `latest` pins. |
| npm | every workspace `package.json` (`pnpm-workspace.yaml` lists them); `pnpm-lock.yaml` | `mise x -- pnpm outdated -r --format json` | `mise x -- pnpm update -r --latest <pkg>…` |
| Go | `packages/controller/go.mod` | `mise x -- go list -m -u -json all` in `packages/controller`; keep entries that are not `Indirect` and have an `Update` | `go get <mod>@<ver>`, then `go mod tidy` |
| Rust | `packages/vm-runner/Cargo.toml`, `platform-init/Cargo.toml`; `Cargo.lock` | `mise x -- cargo info <crate>` for each `[dependencies]` entry | Edit `Cargo.toml`, then `cargo update -p <crate>` |
| smolvm | `packages/vm-runner/smolvm.pin` (tag, commit, per-arch sha256) | its GitHub releases | Rewrite all four lines from the release and its `checksums.sha256`. Then check whether the crane override in `packages/vm-runner/.mise/tasks/oci` can go (see step 3). |
| crane in the VM runner | `crane_version` and per-arch `crane_sha` in `packages/vm-runner/.mise/tasks/oci` | go-containerregistry releases | Version plus both release tarball digests |
| Python | `packages/experiment-sdk/pyproject.toml`; `uv.lock` | `mise x -- uv tree --outdated --depth 1` there | Edit the bound, then `mise x -- uv lock --upgrade-package <pkg>` |
| Base images | `base_image_*` in `.mise/config.toml` `[vars]` | the registry's tags (`mise x -- crane ls <repo>`) | A new tag: edit it, then `mise run image:bump-bases` to pin its digest. A digest behind its tag: `image:bump-bases` alone. |
| Agent image tools | `packages/agents/base/base.toml`, each `packages/agents/*/image.toml`, `packages/e2e/agents/mock/image.toml`; resolved in `packages/agents/base/image.lock` and `image-locks/` | compare each pin to its registry | Edit the pin, then `mise run //packages/agents:oci --lock`. `--lock --bump` re-resolves every `latest`. A `pipx:` tool with `uvx_args` is pinned only in its `image.toml`. A k-search source tree is pinned by commit and checksum. `apt.toml` is `latest` and rebuilt daily: nothing to do. |
| Runtime images | `helm/values.yaml` (`image:`, `repository:`/`tag:`, `jobImage`, `envoyImage`, `configCliImage`); `.mise/tasks/cluster/install`; `.mise/tasks/image/mirror` | each image's registry or releases | Edit the tag. A digest pin (the device plugin) moves with its tag. A mirrored image lands on quay once `image:mirror` runs in CI. |
| Helm chart deps | `helm/Chart.yaml` `dependencies`; `helm/Chart.lock` | the chart repo's index | Edit the version, then `mise x -- helm dependency update helm` to re-lock it. The `helm/` deps provider only builds from `Chart.lock`. |
| Cluster add-ons | `ISTIO_VERSION`, `CERT_MANAGER_VERSION`, `GATEWAY_API_VERSION` and the ClickStack operator chart in `.mise/tasks/cluster/install`; `INSTALL_K3S_VERSION` in `etc/lima/k3s.yaml` and `etc/lima/k3s-test.yaml` | upstream releases | Edit the version |
| GitHub Actions | `uses:` in `.github/workflows/*.yml` and `.github/actions/*/action.yml`; `.pinact.yaml` | `mise x -- pinact run --check -u` | `mise x -- pinact run -u` |

After the edits, look for pins that step 1 did not cover: `git grep -nE '(version|VERSION|_version)[ =:]+"?v?[0-9]+\.[0-9]'` and `git grep -nE '[a-z0-9.-]+\.[a-z]+/[a-z0-9/._-]+:[A-Za-z0-9._-]+'` outside tests and lockfiles.

Show the user the inventory table, sorted by major, then minor, then patch.

## 2. Patch bumps

Apply them all, one commit per ecosystem. Run the checks and tests of the affected packages. A patch that breaks a check gets the same treatment as a major bump (step 3).

## 3. Minor and major bumps

Do these one dependency at a time. The research for several dependencies can run in parallel Agents. Edits to a shared lockfile run one after another.

1. **Read every changelog entry between the current version and the target.** Include the versions in between, not only the target. Read in this order: the migration or upgrade guide, then the GitHub release notes (`gh release view <tag> -R <owner/repo>`), then `CHANGELOG.md`. List every breaking change, deprecation, and new feature.
2. **Check each breaking change against our code.** Grep for every API, flag, config key, or behavior it names. Mark each one as *hits us* (with the `file:line`) or *does not hit us* (with the reason). A deprecation that hits us is migrated now, not later.
3. **Migrate.** Apply the upgrade guide's steps and codemods. Regenerate generated files with the repo's own tooling, not by hand: `controller-gen` output, drizzle migrations, generated types, lockfiles. Update the architecture page of any subsystem whose behavior changes. Bump its `Last verified:` date.
4. **Adopt new features, but only where they:**
   - **simplify our code**: they replace a workaround, polyfill, shim, or hand-rolled helper that the dependency now provides;
   - **drop a dependency**: they make another package, tool, or image redundant, so remove it;
   - **make code more secure**: safer defaults, hardening options, or a supported replacement for an insecure pattern we use.

   To find candidates, search for comments that wait on upstream: `git grep -niE 'upstream|workaround|until .* (ships|releases|supports)|drop this once|as of [0-9]'`. For example, the VM runner replaces smolvm's bundled crane until a smolvm release ships a current one. Do not adopt a feature just because it is new. Each adoption is its own `refactor`, `perf`, or `fix` commit, so it can be reverted on its own.
5. **Verify** with the affected packages' `mise run //packages/<pkg>:check` and `:test`.

If a migration needs a design decision, ask the user with AskUserQuestion. Examples: a framework's new model changes our architecture, or two migration paths trade off differently. Otherwise, do not stop.

A bump that cannot land goes on the blocked list with its reason. Reasons: its migration is too large for this run (file an issue with the `file-issue` skill after approval), a peer dependency is not ready, or it regresses a check that has no fix yet. Revert that bump. Never skip or disable a test to make a bump pass.

## 4. Verify the whole change

- `mise run check` and `mise run test`, plus `mise run check:comment-types`.
- Every image whose inputs changed builds. For the image:pack images and the VM runner: `mise run //packages/<pkg>:oci` (keycloak's package is `keycloak-theme`). For the agent images: `mise run //packages/agents:oci -- <agent>`.
- After a major bump of anything the cluster runs (Kubernetes, the mesh, cert-manager, Keycloak, Postgres, Envoy, the controller's client libraries), run the e2e suite. Use the `cluster-ops` skill, and the `ccweb` skill in a Claude Code on the web sandbox.
- Run the `doc-drift` skill over the diff.

## 5. Present, then commit

Show the user:

| Ecosystem | Dependency | From | To | Kind | Breaking changes that hit us | Migration done | Features adopted |
|---|---|---|---|---|---|---|---|

Also show the blocked list (too young, blocked upstream, or deferred), each with its reason. Wait for the user's approval.

Then commit on a `chore/up-deps-<YYYY-MM-DD>` branch with `git commit -s`, using Conventional Commits:
- one `build(deps): …` commit per ecosystem for its patch and minor bumps;
- one commit per major bump, together with its migration;
- one commit per adopted feature.

Open one PR. Its body is the table above.
