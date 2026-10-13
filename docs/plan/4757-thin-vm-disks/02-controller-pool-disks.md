# 02 — Controller: disks and claim at the owner's pool; usage Secret

**Depends on:** 01-runner-usage, and #4756 merged to main
**Part of:** VM disks grow inside the user's storage pool — see [README](./README.md)

## Context

The controller sizes every vm disk and the owner's claim at the owner's storage ceiling, and hands the api-server what it needs to read usage without the runner token.

## Implementation plan

1. `packages/controller/pkg/reconciler/vm_runner_sizing.go`: `runnerClaimSize` returns the owner's ceiling from #4756's pool resolver; drop the demand terms that only fed the claim (`diskGiB`, `machines`, `seedBytes`) and `noteClaimCapped`.
   Keep `growRunnerPVC` (grow-only) and the create-at-ceiling path for non-expanding classes.
2. `vm_agent.go` `resolveVMDiskGiB`: keep the refusal of a persisted path outside HOME; return the ceiling in GiB.
   Feature detection: for a running machine whose live status has `DiskGiB == 0` (an older runner), keep sending the legacy size, so nothing restarts until its runner hands off.
3. `runtime_migration.go`: the raise of `target.Spec.StorageSize` to the old volume's capacity becomes a no-op on vm.
4. `pkg/config`: refuse an install whose `runner.storage` is not above `imageCache.budget` when the cache lives on the claim.
5. Usage Secret: in the runner build (`vm_runner.go`), apply `<runner>-usage` with keys `capability` (`vmrunner.MintUsageCapability(token)`), `ca.crt` (from the TLS Secret) and `url` (`https://<runnerHost>:<port>`), labelled with the runner's component and owner labels, owned like the token Secret; re-apply when the token or CA changes.
   Host runner: one Secret for the shared runner.
6. `helm/values.yaml`: rewrite the `runner.storage` comment (the ceiling is now each owner's pool and the claim's size).
7. Tests: `vm_runner_sizing_test.go`, vm agent tests for the disk size and feature detection, a test for the usage Secret.
8. Docs: `persistence.md` (vm disk and claim paragraphs, guard and eviction notes), `vm-runner.md`, `starter-kits.md` (a kit's `storage` sizes container agents only).

## Acceptance criteria

- [ ] A new owner's claim is created at the ceiling; an existing smaller claim grows to it.
- [ ] Every vm machine on a new runner asks for the pool's GiB; `spec.storageSize` and mount sizes no longer change a vm disk.
- [ ] A running machine on an old runner keeps its size; upgrading restarts nothing.
- [ ] The usage Secret holds the capability, CA and URL, never the token or the TLS key.
- [ ] Container agents are unchanged.

## Smoke test

`mise run //packages/controller:check`, `mise run //packages/controller:test`, `mise run //helm:check`, `mise run //docs:check`, `mise run //:check:comment-types`.
