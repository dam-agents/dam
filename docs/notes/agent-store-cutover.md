# Agent store cutover and rollback

Last verified: 2026-10-25

This is the operator's procedure for moving Agents and user budgets out of the Kubernetes API and into Postgres, and for rolling one install back inside its window.
[persistence](../architecture/persistence.md) describes what the components do; this page is what a person does.
The change spans three chart releases — expand, switch, contract — and the switch is one short outage per install, taken in the order dev, staging, prod.

## Before the switch (expand release)

The expand release carries the `control` schema, the controller's database login, the startup fences and the dry-run report.
Nothing reads the rows yet and the custom resources stay authoritative.

1. Run the grant fan-out repair, then the dry-run preview:
   - `kubectl exec deploy/<release>-apiserver -- node dist/js/agent-store-cli.js repair-grants --dry-run`
   - `kubectl exec deploy/<release>-apiserver -- node dist/js/agent-store-cli.js repair-grants`
   - set `agentStore.previewReport: true` and read `agentStore.absorbPreview` from the api-server log, or run the preview by setting it for one boot.
     The repair rewrites an Agent's `spec.grantedConnectionIds` from `connection_grants` and security-logs every change; the database wins, and the absorb refuses while any disagreement remains.
     Run it on the expand release, whose api-server still has the write grants; the switch release does not.
2. Name the key holder and put the public key in `agentStore.backup.recipient` before the switch.
   The archive itself is written after the absorb, because it is read from `crd_snapshots`.
3. Record the baseline the rehearsal and the verification compare against: `kubectl get agents -n <agentNamespace>`, `kubectl get userbudgets -A`, the anchors (`kubectl get configmaps -n <agentNamespace> -l agent-platform.ai/agent`), and each live machine's runner and revision.

## The switch release

Set, on the install's values:

```yaml
agentStore:
  authority: postgres
  cutover:
    acknowledged: true # times the outage; the render fails without it
  previewReport: false
  backup:
    recipient: age1… # public key only
```

The render refuses `authority: postgres` without the acknowledgement, so a production install that auto-upgrades on a semver range cannot take the switch on its own.
A failed render leaves the previous release running.

What happens, in order:

1. Both Deployments recreate.
   Every old api-server replica and the old controller are gone before the new ones start; machines keep running.
2. The api-server migrates, verifies with a `SelfSubjectAccessReview` that its identity can no longer write an `Agent` or a `UserBudget`, absorbs, writes the marker `<release>-agent-store`, and waits.
3. The controller takes the Lease, ensures every absorbed Agent has an anchor, and records the holder and the moment.
4. The api-server serves as soon as the Lease's holder is that controller and the record exists, and records `switch_completed_at`.

The api-server is unavailable for that minute or two; its readiness probe fails until the barrier passes.
If the controller cannot start, the api-server stays not-ready — deliberately, because the operator is present.

### Verify

- `control.agent_store` has `absorbed_at`, `backup_ref` (an install with an object store), `controller_holder`, `anchors_ensured_at` and `switch_completed_at`.
- `control.agents` row count equals the Agent count recorded before the switch, and `control.user_budgets` equals the budget count.
- The preview's numbers and the rows agree; the log line `agentStore.absorb.committed` carries both.
- `crd_snapshots` holds one row per custom resource, including any the absorb skipped.
- Every Agent has its anchor ConfigMap, and its children name the anchor, not the custom resource.
- The controller logs a startup anchor pass and reconciles every Agent; the api-server serves UI and API traffic.
- Create, update and delete one throwaway Agent, and confirm the row, the machine and the children follow.
- The api-server's log has no `the absorb refuses`.

### The operator's archive

Write the encrypted file and keep it where the key holder can reach it:

```sh
kubectl exec deploy/<release>-apiserver -- \
  node dist/js/agent-store-cli.js export-snapshot --out /tmp/agent-store.age
kubectl exec deploy/<release>-apiserver -- cat /tmp/agent-store.age > ./<install>-agent-store.age
```

The command prints the archive's SHA-256 and writes ciphertext, or prints ciphertext to stdout without `--out`.
The image carries no `tar`, so `kubectl cp` fails; `exec -- cat` is the form that works.
The plaintext is never printed.
The file is mandatory before the contract release; `agentStore.contract.backupSha256` carries its digest, and `agent-store-cli contract-check --sha256 <digest>` refuses a mismatch.

## Rollback, inside the one-week window

A rollback is a restore of the custom resources from the rows, not a restore of the switch's archive: an Agent created, renamed or re-granted after the switch must come back as it is now.

1. Freeze the install: deploy the switch release again with `agentStore.frozen: true`.
   Both components exit instead of serving, so nothing writes rows while the exporter runs.
   This is another short outage.
2. Restore:
   - `node dist/js/agent-store-cli.js rollback --dry-run` first, from a machine with the cluster credentials and a database connection; it prints what it would do and changes nothing.
   - then the same without `--dry-run`, from a one-off pod or the same machine.
     It writes each row back to a custom resource (new UIDs), deletes the resources whose rows are gone, re-points every child of each Agent to its restored custom resource, deletes the anchors with orphan propagation, verifies that no child still references an anchor, clears the rows and the absorb stamp, and deletes the marker.
     It refuses unless the components are frozen, and it refuses while any child still names an anchor.
3. Pin the previous (expand) release and clear `agentStore.frozen`.
   Its fence accepts the custom resources again because the marker is gone.
   Do not roll back below the expand release: a build older than the fence cannot recognise a switched store, which is what the fence exists to prevent.
4. Re-run the grant fan-out repair if the connections module changed anything in the database during the outage, and expect the controller to re-create the anchors and adopt the children on its first reconcile.

A later re-upgrade re-absorbs with the custom resources authoritative.

## Retiring the custom resources (contract release)

Only after every install is past its window, in the same order dev, staging, prod:

- the contract release stops writing the custom resources and refuses to delete them unless `agentStore.contract.backupSha256` matches the installed archive (`contract-check`);
- deleting the two CRDs is a separate cluster-wide action, taken once, after the last install's window: `kubectl delete crd agents.agent-platform.ai userbudgets.agent-platform.ai`.
  No install's chart or hook ever deletes a shared CRD.

What replaces the old operator habits:

- `upgrade-crds.sh` is gone with the CRDs; schema changes are migrations the api-server runs on startup.
- `kubectl get agents` becomes `kubectl exec … -- node dist/js/agent-store-cli.js export-crds` (plaintext YAML of what the rows hold) or a read-only SQL view; the Agent's own page and the API stay the operator's read path.
- `kubectl annotate agent …` for lifecycle signals is gone; the owner and operator APIs write the signals columns.
- `dam budget` replaces `create-user-budget.sh`; the `user_budgets` table is what it writes.
- A stuck delete is retried from the anchor, and the release-namespace sweep removes what a delete leaked.
