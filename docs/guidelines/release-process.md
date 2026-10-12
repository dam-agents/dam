# Release Process

All monorepo packages (Helm chart, CLI, container images) are versioned and published together.
A single version lives in `helm/Chart.yaml` (version + appVersion) and `packages/cli/package.json`.
The `mise run check:version` task enforces they stay in sync.

## Lifecycle

```
main (0.3.0)
  │
  ├─ mise run release:new
  │    creates release-v0.3.0 branch (0.3.0-rc1)
  │    opens PR bumping main to 0.3.1
  │
  │  release-v0.3.0
  │  │
  │  ├─ mise run release:publish-rc     → tags v0.3.0-rc1, CD publishes, bumps to 0.3.0-rc2
  │  ├─ (cherry-pick fixes, repeat)
  │  ├─ mise run release:publish-rc     → tags v0.3.0-rc2, CD publishes, bumps to 0.3.0-rc3
  │  └─ mise run release:publish-stable → tags v0.3.0, CD publishes
  │
  v
main (0.3.1)
```

### 1. Open a release — `mise run release:new`

Run from a clean working directory.
The task:

1. Checks out and pulls `main`.
2. Reads the current version (e.g. `0.3.0`) from Chart.yaml.
3. Creates `release-v0.3.0` from `main`, bumps it to `0.3.0-rc1`, pushes.
4. Opens a PR bumping `main` to `0.3.1`, with auto-merge enabled (`main` is protected and requires one approval, so direct pushes don't work).

To release a different version than what's on main, run `mise run release:set-version <version>` on `main` first.

### 2. Publish a release candidate — `mise run release:publish-rc`

Run from the release branch.
The task:

1. Tags the current commit (e.g. `v0.3.0-rc1`) and pushes tag + branch atomically.
2. The `v*` tag triggers the release jobs in [`cd.yml`](../../.github/workflows/cd.yml): images are built, Helm chart is pushed, CLI is published to npm with `--tag rc`.
3. Bumps the branch to the next RC (`0.3.0-rc2`).

Repeat as needed — cherry-pick fixes onto the release branch and publish another RC.

### 3. Publish stable — `mise run release:publish-stable`

Run from the release branch when the latest RC is validated.
The task:

1. Strips the `-rcN` suffix (e.g. `0.3.0-rc3` → `0.3.0`), commits.
2. Tags `v0.3.0` and pushes.
3. CD publishes everything as a stable release (images tagged `latest`, npm `--tag latest`).

## Hotfix — `mise run release:hotfix [base]`

A hotfix ships a fix on top of the release in production, without the rest of `main`.
Run from a clean working directory.
The task:

1. Takes the tag of the latest published GitHub Release (e.g. `v0.3.0-rc2`), or the tag given as `base`.
   A published Release is what production runs; a stable tag alone is not.
2. Takes the next patch above every existing version tag and `release-v*` branch (e.g. `0.3.1`, or `0.3.2` when `0.3.1` is tagged but never published).
   It warns when it skips versions, because the hotfix does not contain them.
3. Creates `release-v0.3.1` from the base tag, not from `main`, bumps it to `0.3.1-rc1`, pushes.
4. If `main` is at `0.3.1` or lower, opens a PR bumping `main` to `0.3.2` and closes any older bump PR, so the next regular release does not reuse the hotfix version.

Then merge the fix to `main` first, cherry-pick it onto the hotfix branch with `git cherry-pick -x <sha>`, push, and publish with `release:publish-rc` or `release:publish-stable` as for any release.

`release:new` stops when its `release-v*` branch already exists, which happens when a hotfix took the version and the bump PR is not merged yet.

## Utilities

| Task | Purpose |
|---|---|
| `mise run release:status` | Show current version, latest release branch, latest tag, CD link |
| `mise run release:checkout` | Check out the latest `release-v*` branch |
| `mise run release:set-version <ver>` | Manually set version across all packages and commit |

## What CD publishes

On every `v*` tag push, the release jobs in [`cd.yml`](../../.github/workflows/cd.yml):

- Builds and pushes container images (platform components + agents) to `quay.io/dam-agents/*`
- Packages and pushes the Helm chart to `oci://quay.io/dam-agents/charts`
  - The keycloak image tag is pinned to a content tag (the commit that last touched its inputs) rather than the release version, so upgrading to a release that didn't change the image doesn't restart Keycloak
  - The VM runner image is pinned by digest, and a rebuild whose content equals the image it would replace keeps that image and its digest, so a release that didn't change the runner doesn't reboot every vm machine
- Publishes `@dam-agents/cli` to npm (stable tags get `latest`, RC tags get `rc`)

A release waits for every image the chart names, so a `v*` chart never references a tag that was never built.

On every push to `main` (no tag), CD builds images and pushes a dev Helm chart (`0.0.0-main.*`).
The dev chart does **not** wait for the agent image chain — it publishes as soon as the platform images are merged, which is most of the time between a merge and a usable chart.
For the few minutes until the agent images are tagged, the dev chart names agent images that aren't pullable yet: creating or upgrading an agent fails to pull and recovers on its own once the tags land.
If an agent build fails outright, that window lasts until the next green `main` run.
This tradeoff is deliberate and applies to the dev channel only.
