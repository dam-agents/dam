# Per-user VM pools

> Working plan — temporary, committed on the feature branch.
> Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/4756 (epic https://github.com/dam-agents/dam/issues/4753)

## Goal

An admin can give one user a larger or smaller VM memory, CPU and storage pool.
Every other user keeps the install defaults.
A change reaches the user's runner without restarting their agents.

## Approach

The pool is the owner's VM runner ([vm-memory](../../architecture/vm-memory.md), [vm-runner](../../architecture/vm-runner.md)): its memory limit, the cap on its CPU limit, and the ceiling of its claim ([persistence](../../architecture/persistence.md)).
Today all three come from `virtualization.runner.*` and are the same for everyone.
The existing `UserBudget` ([budgets](../../architecture/budgets.md)) becomes the override for all three:

- `cpu` and `memory` become optional and also set the VM pool; `storage` is new and optional.
- Each field falls back to its own default: `controller.userBudgets` for the container ceiling, `virtualization.runner.*` for the VM pool.
- No new CRD.
  The only CRD change is these UserBudget fields.

The controller resolves an owner's pool once per reconcile of their vm agent and once per memory pass (every 30 s), and keeps it in memory.
Everything that read the install's runner limit reads the owner's pool instead: machine size, pressure and reclaim, the runner pod's memory request and CPU limit, and the claim ceiling.

A pool change never rolls the runner pod:

- The pod's memory and CPU limits are changed in place through `pods/resize`, like the memory request and CPU limit are today.
- The runner reads its live limit from its cgroup's `memory.max` at every admission, so it admits against the new limit at once.
- The Deployment renders the owner's memory limit for pods it creates, but the roll hash leaves the memory limit out.

A lowered pool never kills anything:

- Reclaim and pressure target the new pool at once, so idle agents hibernate under the usual rules.
- The pod's limit falls to the new pool only as use allows; until then it sits at what the running machines are counted at, so no new machine fits.
- A lowered storage ceiling only stops future claim growth: Kubernetes never shrinks a claim.

## Sub-issues

| #   | Title                                            | Scope                                                               | Depends on |
| --- | ------------------------------------------------ | ------------------------------------------------------------------- | ---------- |
| 01  | UserBudget overrides the VM pool (done)          | CRD fields, owner pool resolution, claim ceiling, api-server reader | —          |
| 02  | The runner admits against its live memory limit  | vm-runner reads `memory.max`                                        | —          |
| 03  | The owner's pool reaches the runner pod in place | pod limits resized, pool in machine size and reclaim, roll hash     | 01, 02     |

## Conventions & glossary

- **Pool**: what one owner's vm agents share — the runner's memory limit, its CPU limit cap, its claim ceiling.
- **Override**: a `UserBudget` field; an absent field means the install default.
- Code comments follow `docs/guidelines/comment-guidelines.md` (typed only); run `mise run //:check:comment-types`.
- Server-side TS in `packages/api-server`: apply `/typescript-engineering`.

## Whole-feature smoke test

On a local cluster with virtualization (`mise run //:cluster:install`):

1. Create a vm agent and note its runner pod's UID and `resources`.
2. `kubectl apply` a UserBudget for that owner with `memory` above the install's runner limit and a larger `storage`.
3. Within about 30 s the runner pod's `limits.memory` is the new value, its UID is unchanged, the agent did not restart, and the claim grew.
4. Lower `memory` below current use: the limit stays at use, idle agents hibernate, nothing is killed.

## Delivery

Each sub-issue is one atomic commit.
The whole feature lands as a single PR for https://github.com/dam-agents/dam/issues/4756.
