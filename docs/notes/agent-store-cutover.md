# Agent store cutover and rollback

Last verified: 2026-10-24

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

The command encrypts to the install's `agentStore.backup.recipient` and refuses a `--recipient` that differs from it unless `--force-recipient` says so, printing both.
The image carries no `tar`, so `kubectl cp` fails; `exec -- cat` is the form that works, and the pod's `/tmp` ciphertext is deleted after it.
The plaintext is never printed.
The switch's object-store copy is plaintext YAML in the platform's own bucket (it can carry a legacy `spec.env`); this encrypted file is the copy that leaves the platform.
It is mandatory before the contract release; `agentStore.contract.backupSha256` carries the digest of the YAML archive (not of the ciphertext, which is randomized), and `agent-store-cli contract-check --sha256 <digest>` compares it exactly.

## Rollback, inside the one-week window

A rollback is a restore of the custom resources from the rows, not a restore of the switch's archive: an Agent created, renamed or re-granted after the switch must come back as it is now.

1. Freeze the install: deploy the switch release again with `agentStore.frozen: true`.
   Both components exit instead of serving, so nothing writes rows while the exporter runs.
   This is another short outage.

2. Restore:
   - `node dist/js/agent-store-cli.js rollback --dry-run` first; it prints what it would do and changes nothing.
   - then the same without `--dry-run`.
   - Run it in a one-off pod in the cluster (the api-server image, the rollback Role below, the api-server's own database environment), not from a workstation: the store is bound to the install by the API server address the absorb used, and a workstation dials a different one.
     The pod also keeps the database credential off a laptop.
   - It refuses unless the database was absorbed *by this install* and the cluster's marker names the same absorb stamp; a wrong `DATABASE_URL` is a refusal, not a fleet that vanished.
     When a killed rollback already deleted the marker, the install recorded in the absorb report lets the rerun finish.
     A rerun after a finished rollback does nothing.
   - It refuses unless the cluster shows the freeze: both Deployments render it, run no replica, have no pod left, and the controller's Lease is not renewed.
   - It writes each row back to a custom resource (whole: a grant revoked, a host removed or a flag turned off after the switch comes back cleared, and the status is restored), creates the ones that were created after the switch (new UIDs), deletes only resources the absorb recorded and whose rows are gone — Agents and UserBudgets alike, so a budget removed in row mode does not come back — re-points every child of each Agent — NetworkPolicies included — to its restored custom resource, verifies that no child still references an anchor, deletes the anchors with orphan propagation, deletes the marker, and only then clears the rows and the absorb stamp.

   The Role is a one-off, bound to a ServiceAccount that only the rollback pod uses.
   It carries every verb the command calls: the release-namespace reads that observe the freeze, and the agent-namespace reads and writes that restore, re-point, orphan and clear.

```yaml
apiVersion: v1
kind: ServiceAccount
metadata: { name: agent-store-rollback, namespace: <release namespace> }
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata: { name: agent-store-rollback, namespace: <release namespace> }
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata: { name: agent-store-rollback, namespace: <release namespace> }
roleRef: { apiGroup: rbac.authorization.k8s.io, kind: Role, name: agent-store-rollback }
subjects: [{ kind: ServiceAccount, name: agent-store-rollback, namespace: <release namespace> }]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata: { name: agent-store-rollback, namespace: <agent namespace> }
rules:
  - apiGroups: ["coordination.k8s.io"]
    resources: ["leases"]
    verbs: ["get"]
  - apiGroups: ["agent-platform.ai"]
    resources: ["agents", "userbudgets"]
    verbs: ["get", "list", "create", "update", "patch", "delete"]
  - apiGroups: ["agent-platform.ai"]
    resources: ["agents/status"]
    verbs: ["get", "update", "patch"]
  - apiGroups: ["agent-platform.ai"]
    resources: ["agents/finalizers"]
    verbs: ["update"]
  - apiGroups: [""]
    resources: ["configmaps"]
    verbs: ["get", "list", "create", "update", "patch", "delete"]
  - apiGroups: ["apps"]
    resources: ["statefulsets"]
    verbs: ["get", "list", "update", "patch"]
  - apiGroups: [""]
    resources: ["services", "serviceaccounts", "secrets"]
    verbs: ["get", "list", "update", "patch", "delete"]
  - apiGroups: ["networking.k8s.io"]
    resources: ["networkpolicies"]
    verbs: ["get", "list", "update", "patch"]
  - apiGroups: ["cert-manager.io"]
    resources: ["certificates"]
    verbs: ["get", "list", "update", "patch"]
  - apiGroups: ["security.istio.io"]
    resources: ["authorizationpolicies"]
    verbs: ["get", "list", "update", "patch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata: { name: agent-store-rollback, namespace: <agent namespace> }
roleRef: { apiGroup: rbac.authorization.k8s.io, kind: Role, name: agent-store-rollback }
subjects: [{ kind: ServiceAccount, name: agent-store-rollback, namespace: <release namespace> }]
```

Remove the ServiceAccount, the two Roles and the two RoleBindings after the window closes.

3. Pin the previous (expand) release and clear `agentStore.frozen`.
   Its fence accepts the custom resources again because the marker is gone.
   Do not roll back below the expand release: a build older than the fence cannot recognise a switched store, which is what the fence exists to prevent.
4. Re-run the grant fan-out repair if the connections module changed anything in the database during the outage.
   In CR mode there are no anchors: the controller renders from the custom resources again and adopts the children on its first reconcile, and owner references to a custom resource are what it expects.

A later re-upgrade re-absorbs with the custom resources authoritative.

## Retiring the custom resources (contract release)

Only after every install is past its window, in the same order dev, staging, prod.

1. Check the gate before the release, in the switch release's api-server pod:

   ```sh
   kubectl exec -n <ns> deploy/<release>-apiserver -- \
     node dist/js/agent-store-cli.js contract-check --sha256 <digest>
   ```

   It refuses until the install was switched, a week has passed since `switch_completed_at`, the snapshot table still reads back to the digest the absorb recorded, and `--sha256` is that digest.
   `--sha256` defaults to `agentStore.contract.backupSha256`; `--now <iso>` moves the clock, for a rehearsal only.

2. Release the contract values, which are the switch's plus the attested digest:

   ```yaml
   agentStore:
     authority: contract
     cutover:
       acknowledged: true
     contract:
       backupSha256: <the digest export-snapshot printed>
   ```

   The api-server refuses to start if the gate does not pass, so a value set too early is a crash-loop for a second, then the release before it keeps serving.
   The release reads no custom resource and renders no RBAC for the group; the controller skips the CRD schema check.
   Once it runs, the marker carries `contract-at`, and `agent-store-cli contract-check` says the same thing the startup gate did.

3. Delete this install's custom resources, once, with a kubeconfig whose identity may delete them (the contract release's own ServiceAccount may not, deliberately):

   ```sh
   PLATFORM_RELEASE_NAME=<release> NAMESPACE=<agentNamespace> \
     node dist/js/agent-store-cli.js delete-crs --dry-run
   # then the same without --dry-run
   ```

   It refuses without the marker's `contract-at`, deletes each `Agent` and `UserBudget` with `Orphan` propagation — the anchors own the children, so no machine, Service or Secret goes with them — and a rerun, or a cluster whose CRDs are already gone, deletes nothing.

4. Only when every install on the cluster is past step 2 (its marker has `contract-at`), retire the kinds cluster-wide, once:

   ```sh
   mise run cluster:retire-crds -- --backup ./crds-retired.yaml
   ```

   It refuses while any install's namespace runs an api-server with no store marker, or a marker without `contract-at` — an install on the custom resources, or one inside its rollback window — and prints each of them.
   It writes every remaining `Agent` and `UserBudget` across installs to the backup file (mode 600: a legacy `spec.env` may be in it), prints the file's SHA-256, then deletes `agents.agent-platform.ai` and `userbudgets.agent-platform.ai`.
   A second run reports them already retired.
   The same script is mirrored into dam-ops as `retire-crds.sh`, where a prod cluster runs it with `KUBECTL=` pointing at that cluster.
   No install's chart or hook ever deletes a shared CRD.

5. An install created after that point starts on the rows and takes `contract` with `agentStore.contract.emptyArchive: true` (it never absorbed a custom resource, so there is no archive to attest).

What replaces the old operator habits:

- `upgrade-crds.sh` is gone once the CRDs are: schema changes are migrations the api-server runs on startup, and no CRD schema generation is applied any more.
- `kubectl get agents` becomes `kubectl exec … -- node dist/js/agent-store-cli.js export-crds` (plaintext YAML of what the rows hold) or a read-only SQL view; the Agent's own page and the API stay the operator's read path.
- `kubectl annotate agent …` for lifecycle signals is gone; the owner and operator APIs write the signals columns.
- `dam budget` replaces `create-user-budget.sh`; the `user_budgets` table is what it writes.
- A stuck delete is retried from the anchor, and the release-namespace sweep removes what a delete leaked.
