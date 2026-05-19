# Release Process

All monorepo packages (Helm chart, CLI, container images) are versioned and published together. A single version lives in `deploy/helm/platform/Chart.yaml` (version + appVersion) and `packages/cli/package.json`. The `mise run common:check:version` task enforces they stay in sync.

## Lifecycle

```
main (0.3.0)
  │
  ├─ mise run release:new
  │    creates release-v0.3.0 branch (0.3.0-rc1)
  │    bumps main to 0.3.1
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

Run from a clean working directory. The task:

1. Checks out and pulls `main`.
2. Reads the current version (e.g. `0.3.0`) from Chart.yaml.
3. Creates `release-v0.3.0` from `main`, bumps it to `0.3.0-rc1`, pushes.
4. Bumps `main` to `0.3.1`, pushes.

To release a different version than what's on main, run `mise run release:set-version <version>` on `main` first.

### 2. Publish a release candidate — `mise run release:publish-rc`

Run from the release branch. The task:

1. Tags the current commit (e.g. `v0.3.0-rc1`) and pushes tag + branch atomically.
2. The `v*` tag triggers the [CD workflow](.github/workflows/cd.yml): images are built, Helm chart is pushed, CLI is published to npm with `--tag rc`.
3. Bumps the branch to the next RC (`0.3.0-rc2`).

Repeat as needed — cherry-pick fixes onto the release branch and publish another RC.

### 3. Publish stable — `mise run release:publish-stable`

Run from the release branch when the latest RC is validated. The task:

1. Strips the `-rcN` suffix (e.g. `0.3.0-rc3` → `0.3.0`), commits.
2. Tags `v0.3.0` and pushes.
3. CD publishes everything as a stable release (images tagged `latest`, npm `--tag latest`).

## Utilities

| Task | Purpose |
|---|---|
| `mise run release:status` | Show current version, latest release branch, latest tag, CD link |
| `mise run release:checkout` | Check out the latest `release-v*` branch |
| `mise run release:set-version <ver>` | Manually set version across all packages and commit |

## What CD publishes

On every `v*` tag push, the [CD workflow](../../.github/workflows/cd.yml):

- Builds and pushes container images (platform components + agents) to `quay.io/dam-agents/*`
- Packages and pushes the Helm chart to `oci://quay.io/dam-agents/charts`
- Publishes `@dam-agents/cli` to npm (stable tags get `latest`, RC tags get `rc`)

On every push to `main` (no tag), CD builds images and pushes a dev Helm chart (`0.0.0-main.*`).
