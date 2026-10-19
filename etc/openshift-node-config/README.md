# OpenShift node configuration

Node configuration for an OpenShift cluster that runs the platform with VM agents.
Applying either file drains and reboots every node of the pools it reaches, one node at a time per pool, so a cluster admin applies them at a scheduled time.
[`cluster-owner-requests.md`](cluster-owner-requests.md) lists what else the platform asks of the cluster owner.

## Files

| File                                                                     | Kind                          | What it does                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------ | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`99-worker-platform-host-dirs.yaml`](99-worker-platform-host-dirs.yaml) | MachineConfig, Ignition 3.5.0 | Creates the platform's node directories as `root:root`, `0755` and the image cache `0700`, through a tmpfiles.d entry, and labels each one `system_u:object_r:container_file_t:s0` on every boot through a oneshot unit that runs before CRI-O and the kubelet. |
| [`worker-image-gc.yaml`](worker-image-gc.yaml)                           | KubeletConfig                 | Starts kubelet image garbage collection at 75% disk use and collects down to 65%, for images unused for at least 30 minutes.                                                                                                                                    |

### The node directories

The chart's defaults and the values an OpenShift install uses for them:

| Path                                   | Chart value                             | Writer                  | Readers                                                 |
| -------------------------------------- | --------------------------------------- | ----------------------- | ------------------------------------------------------- |
| `/var/lib/platform-vm-runner-releases` | `virtualization.runner.releaseHostPath` | the release stager      | VM runners, read-only                                   |
| `/var/lib/platform-images`             | `virtualization.imageCache.hostPath`    | the image cache service | VM runners, read-only, and the cache's socket inside it |
| `/var/lib/platform-harness-tools`      | none                                    | none                    | none                                                    |

Each install's cache directory is its own subdirectory of `/var/lib/platform-images`, named by its `agentNamespace`, and the chart refuses one that is not: the nodes are shared, and the service is the only writer of the directory it serves.
The kubelet creates that subdirectory on the node, and it inherits the label this MachineConfig puts on the directory above it.

`/var/lib/platform-harness-tools` held the harness tools before the default image baked them, and no pod mounts it any more.
The MachineConfig still creates it, because a change to the MachineConfig drains and reboots every node; drop it the next time the MachineConfig changes for another reason.

If an install sets other paths in its values, change the paths in the MachineConfig to match: the tmpfiles entry is URL-encoded in the file's `source`, decoded in the comment above it.

Without the MachineConfig, the kubelet creates each directory for its `DirectoryOrCreate` volume with the host's `var_lib_t` label, which a confined container (`container_t`) may neither read nor write.
Today each writer works around that by running as the unconfined `spc_t` and labelling the directory from inside the pod.
With the MachineConfig, the directory exists with the right label before any pod starts, so the writers no longer need `spc_t` (see [Follow-up chart changes](#follow-up-chart-changes)).

Why this label and mechanism:

- `container_file_t` at `s0` with no categories is readable by every confined pod, whatever category pair it gets.
- New files take their parent directory's type and the level of the process that creates them.
  So everything a writer creates below a labelled directory is `container_file_t`, and stays at `s0` as long as the writer runs at `level: s0`.
- `container_file_t` is a customizable type: `restorecon` and an autorelabel leave files that carry it alone.
  The boot-time `chcon` therefore only matters for a newly created directory, and touches only the three top directories, not the possibly hundreds of thousands of files below them.
  A forced relabel (`restorecon -F`, or `/.autorelabel` with `-F`) does reset the contents; recover with `chcon -R -h system_u:object_r:container_file_t:s0 <dir>`, or empty the two caches so they refill.
- tmpfiles `z`/`Z` lines can only restore the policy default (`var_lib_t`).
  `semanage fcontext` would make the label policy-native, but it modifies the policy store under `/etc/selinux`, which rpm-ostree's 3-way `/etc` merge then keeps over newer OS images' policy.

### Every node host path the platform mounts

| Host path                                                                        | Mounted by                                                                                                     | Label and mode it needs                 | Created by this MachineConfig               |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------- |
| `virtualization.imageCache.hostPath` (under `/var/lib/platform-images`)          | image cache service (writes); VM runners (read-only, from the controller)                                      | `container_file_t:s0`, `root:root 0700` | yes                                         |
| `virtualization.runner.releaseHostPath` (`/var/lib/platform-vm-runner-releases`) | release stager (writes); VM runners (read-only, from the controller)                                           | `container_file_t:s0`, `root:root 0755` | yes                                         |
| `/var/lib/kubelet/device-plugins`, `/dev`                                        | KVM device plugin ([`helm/extra/kvm-device-plugin.yaml`](../../helm/extra/kvm-device-plugin.yaml)), privileged | the host's own labels                   | no: system paths, and the pod is privileged |

Every other volume the chart and the controller create is a claim, a ConfigMap, a Secret, a projected volume or an `emptyDir`.

## Which pools the files reach

- The MachineConfig carries `machineconfiguration.openshift.io/role: worker`.
  It reaches the `worker` pool and every custom pool whose `machineConfigSelector` also selects `worker` MachineConfigs, as custom pools usually do (for example a pool for OpenShift sandboxed containers, Kata).
  That is intended: VM runners and container agents may land on any worker that offers `/dev/kvm` or runs agents, and the directories are harmless on the others.
- The KubeletConfig selects the `worker` pool by `pools.operator.machineconfiguration.openshift.io/worker`.
  MCO renders it as the MachineConfig `99-worker-generated-kubelet` with `role: worker`, so custom pools that inherit `worker` MachineConfigs get the thresholds and the reboot too.
- A pool may take several KubeletConfigs; if one already targets the `worker` pool, consider merging these fields into it rather than adding another.

Check before applying:

```sh
oc get mcp -o custom-columns=NAME:.metadata.name,NODES:.spec.nodeSelector.matchLabels,MCS:.spec.machineConfigSelector,MAXUNAVAILABLE:.spec.maxUnavailable,COUNT:.status.machineCount
oc get kubeletconfig -o custom-columns=NAME:.metadata.name,POOLS:.spec.machineConfigPoolSelector
```

## Drain risks to check first

Each pool updates `maxUnavailable` nodes at a time (default 1): cordon, drain, write the files, reboot, uncordon.
Pools update in parallel, so with two pools two nodes are down at once.

- **PodDisruptionBudgets that allow 0 disruptions** block a node's drain until something else moves the pod; MCO retries and marks the pool degraded after about an hour.
  A database operator's primary PDB (CloudNativePG, for example) is a typical one: the drain waits for a switchover.

  ```sh
  oc get pdb -A -o custom-columns=NS:.metadata.namespace,NAME:.metadata.name,ALLOWED:.status.disruptionsAllowed | awk 'NR==1 || $3=="0"'
  ```

- **Platform pods on a single node**: when an install's api-server, controller, Keycloak, object store and UI share a node, that install is briefly down while the node drains.
  Check where they run and expect the outage then:

  ```sh
  oc get pods -n <platform-namespace> -o custom-columns=NAME:.metadata.name,NODE:.spec.nodeName
  ```

- Every container agent restarts once, when its node drains, and every VM runner's restart reboots all of its owner's machines.
  An agent and its gateway on different pools restart at different times.

Expect 6 to 10 minutes per node (drain plus an RHCOS reboot), times the node count of the largest pool, divided by its `maxUnavailable`.

## Apply

1. Check every pool the files reach is idle (`UPDATED=True`, `UPDATING=False`, `DEGRADED=False`):

   ```sh
   oc get mcp
   ```

2. Pause those pools, so MCO renders both changes into one config and each node reboots once.
   `<custom-pool>` stands for every custom pool that inherits `worker` MachineConfigs, here and below; leave it out on a cluster with none.

   ```sh
   oc patch mcp worker <custom-pool> --type merge -p '{"spec":{"paused":true}}'
   ```

   Keep the pause short: a paused pool also holds back MCO's own updates, such as the kubelet CA rotation.

3. Apply both files:

   ```sh
   oc apply -f etc/openshift-node-config/99-worker-platform-host-dirs.yaml -f etc/openshift-node-config/worker-image-gc.yaml
   ```

4. Wait until the KubeletConfig has rendered and each paused pool's next config includes both:

   ```sh
   oc get kubeletconfig worker-image-gc -o jsonpath='{.status.conditions[*].type}={.status.conditions[*].status}{"\n"}'
   oc get mcp worker <custom-pool> -o custom-columns='NAME:.metadata.name,SOURCES:.spec.configuration.source[*].name'
   ```

   Each list must name `99-worker-platform-host-dirs` and `99-worker-generated-kubelet`; repeat until it does.

5. Unpause:

   ```sh
   oc patch mcp worker <custom-pool> --type merge -p '{"spec":{"paused":false}}'
   ```

6. Watch until every pool reports all machines updated and none degraded:

   ```sh
   oc get mcp -w
   oc get nodes -w
   oc get events -n openshift-machine-config-operator --sort-by=.lastTimestamp | tail -20
   ```

7. Spot-check a node of each pool, read-only:

   ```sh
   oc debug node/<node> -q -- chroot /host sh -c '
     stat -c "%n %U:%G %a %C" /var/lib/platform-vm-runner-releases /var/lib/platform-images /var/lib/platform-harness-tools
     systemctl is-active platform-host-dirs-label.service
     grep -E "imageGC(High|Low)ThresholdPercent|imageMinimumGCAge" /etc/kubernetes/kubelet.conf'
   ```

   Expected: each directory `root:root 755 system_u:object_r:container_file_t:s0`, `/var/lib/platform-images` at `700`, the unit `active`, and the kubelet values `75`, `65` and `30m`.

## Roll back

Roll back the [chart changes](#follow-up-chart-changes) first, if they have shipped: the writers then label the directories themselves again.
Then the same pause, delete, check, unpause sequence, which rolls the pools once more:

```sh
oc patch mcp worker <custom-pool> --type merge -p '{"spec":{"paused":true}}'
oc delete kubeletconfig worker-image-gc
oc delete mc 99-worker-platform-host-dirs
oc get mcp worker <custom-pool> -o custom-columns='NAME:.metadata.name,SOURCES:.spec.configuration.source[*].name'
oc patch mcp worker <custom-pool> --type merge -p '{"spec":{"paused":false}}'
```

Deleting the MachineConfig removes the tmpfiles entry and the unit, but leaves the directories and their labels on disk, so running pods keep working.

## Follow-up chart changes

Make these only after every node of every reached pool passes the spot-check.
Both writers keep the SCC that admits a host directory and leaves SELinux options to the pod (`seLinuxContext: RunAsAny`): the hostPath needs it, and so does pinning `level: s0`, without which a pod gets its namespace's category pair and writes files other namespaces cannot read.

**Release stager** ([`vm-runner-releases.yaml`](../../helm/templates/controller/vm-runner-releases.yaml)):

- Drop `seLinuxOptions.type: spc_t` and keep `level: s0`.
- Drop `--selinux-label`: new files inherit the type, and a confined container may not be allowed to relabel.
- On OpenShift, change the hostPath type from `DirectoryOrCreate` to `Directory`, so a node without the MachineConfig fails the stager visibly instead of getting a directory the runners cannot read.
  Elsewhere nothing pre-creates the directory, so it stays `DirectoryOrCreate`.
- Keep `DAC_OVERRIDE` until the runner image's file modes are fixed (below).

**Image cache service** ([`vm-image-cache.yaml`](../../helm/templates/controller/vm-image-cache.yaml)):

- Drop `seLinuxOptions.type: spc_t`, keep `level: s0`, and drop `--selinux-label`.
- Keep `CHOWN`, `FOWNER`, `FSETID` and `DAC_OVERRIDE`: they unpack image trees with their owners and modes, and have nothing to do with SELinux.
- On OpenShift, change the hostPath type to `Directory`.
- Test on a dev install first: runners then connect to the cache's socket held by a confined process at `s0`, instead of an unconfined one.

The controller mounts the same two directories into runners as `DirectoryOrCreate`; on OpenShift, switch those to `Directory` in the same change, so a pod on a node without them fails visibly.
Update the text that says the writers run as `spc_t`: the `values.yaml` comments, the `_validators.tpl` messages and the architecture pages ([VM runner upgrades](../../docs/architecture/vm-runner-upgrades.md), [VM image cache](../../docs/architecture/vm-image-cache.md), [agent images](../../docs/architecture/agent-images.md)).

**Runner image file modes, so the stager can drop `DAC_OVERRIDE`.**
The stager holds `DAC_OVERRIDE` on OpenShift (`DAC_READ_SEARCH` elsewhere) only to read guest-agent files in its own image whose mode keeps even their owner out.
Make those files owner-readable in the runner image build, then drop the capability from the stager on every platform.
The stager copies the guest agent's root filesystem with its modes, so check that the guest does not rely on the restrictive mode before changing it.

## Runner release hand-offs

Every install with runner pods has a release directory: `virtualization.runner.releaseHostPath` defaults to `/var/lib/platform-vm-runner-releases`, and the chart refuses an empty one.
Give the nodes that directory first, with the chart changes above.

1. Set `virtualization.runner.releaseHostPath` in the install's values if the default does not fit, and upgrade the release.
   The chart deploys the release stager on the runners' nodes.
   Each install stages into its own subdirectory, named after its agent namespace, because every stager keeps only the newest few releases in its directory.
   A chart from before the subdirectories staged releases at the top of the directory; nothing reads those any more, and they can be removed by hand.
2. The upgrade to a chart that names releases over the machine API changes every runner pod's shape, whether or not the install had a release directory before, so the controller rolls every runner once, and each roll reboots all of that owner's machines.
   The roll follows `virtualization.runner.rollout`: `maxConcurrent` runners at a time, and a runner whose owner has an agent in the middle of a turn waits for it to go idle, at most `idleWait`.
   Expect the whole roll to take about owners / `maxConcurrent` × (runner restart + machine boot), plus the idle waits.
3. From then on, a new runner image reaches each runner pod in place: the loader hands the machines to the new release, and no machine reboots.
   The first live hand-off is the first proof of the hand-off on OpenShift; it happens at the next chart upgrade that changes the runner image.

Watch the first hand-off:

```sh
oc get ds -n <agent-namespace> -l app.kubernetes.io/component=vm-runner-releases
oc logs -n <agent-namespace> -l app.kubernetes.io/component=vm-runner-releases --tail=5 | grep 'staged the runner release'
oc logs -n <agent-namespace> -l app.kubernetes.io/component=vm-runner --tail=200 --prefix | grep -E 'handing the machines off|started the runner|going back to the one it replaced|the runner exited'
oc get pods -n <agent-namespace> -l app.kubernetes.io/component=vm-runner -o custom-columns=NAME:.metadata.name,RESTARTS:.status.containerStatuses[0].restartCount,STARTED:.status.startTime
```

A good hand-off logs `handing the machines off to another runner release`, then `started the runner` with the new release, in each runner pod.
The runner pods keep their start time and restart count, and the agents' sessions keep running: their machines did not reboot.
A line with `going back to the one it replaced` means the new release failed and the loader returned to the old one; the machines keep running on it, and the controller rolls that runner's pod onto the new image only when the release was built for another pod.

To leave a runner release, configure the previous runner image again and upgrade: the same hand-off takes the machines back to it.
A hand-off the controller finds in trouble is marked with the `agent-platform.ai/runner-handoff-stalled` annotation on that runner's Deployment and halts the release; remove the annotation to let it go on.
The directory and its staged releases stay on the nodes until removed by hand.
