# Requests to an OpenShift cluster owner

Changes the platform needs from whoever owns the OpenShift cluster, beyond the files in this directory.
Each request states the symptom we measured, in general terms, and what we ask for.

## Kubelet image GC and root disks

### Symptoms

- On workers with a ~100 GB root disk, the disk fills to 82–85% during working hours.
- At that level two kubelet mechanisms start at the same point: image garbage collection (default `imageGCHighThresholdPercent: 85`) and eviction (`imagefs.available < 15%`).
  So nodes enter DiskPressure before unused images are removed.
- During DiskPressure, the kubelet refuses gateway and DaemonSet pods, evicts VM runner pods mid-session, and evicted pods re-pull their images when they are recreated.
  Nodes spent up to an hour and a half in DiskPressure over two days.
- During a large image pull the root disk is ~98% busy at ~49 MB/s, and CRI-O delays every pod sandbox and container creation on that node until the pull ends: pod starts take 6–45 s instead of ~2 s.

### Asks

1. **Start image GC below the eviction point**, for the worker MachineConfigPools.
   This is [`worker-image-gc.yaml`](worker-image-gc.yaml); see the [README](README.md) for the pools it reaches and the rollout.
2. **Larger and faster root disks** on the workers that run agents and VM runners: 250 GB on a higher IOPS profile would remove most DiskPressure and shorten image extraction.
3. Optional: check whether CRI-O can extract image layers without blocking unrelated sandbox creation on the same node (the image-store lock is held during extraction).

On the platform side, the default agent image's layers are being made reproducible and smaller, so a deploy pulls far less per node, and the VM image cache budget is lower.

## StackRox admission control

### Symptoms

- The StackRox `policyeval.stackrox.io` validating webhook (failurePolicy Ignore, timeout 12 s) matches pods and every workload kind, StatefulSets included.
- For an image it has not cached, the admission controller asks Sensor for the image, and Sensor scans it through Central before the webhook answers.
  That takes 1–10 s and gives up at a 10 s deadline (`context deadline exceeded`, or `acquiring scan semaphore: context deadline exceeded`); the request is then allowed.
- Every agent create or image update waits for it, because the platform's controller writes the agent's StatefulSet synchronously.
- Measured with server-side dry runs:
  - a StatefulSet with cached images: 110–125 ms, at most ~350 ms;
  - a StatefulSet with an image StackRox had not seen: 3–10.5 s, the slowest hitting the deadline;
  - the same images again: mostly ~120 ms, but up to 2.4 s on another admission-control replica, since each of the replicas keeps its own cache.
- The API server's webhook latency metric showed a small share of creates taking 1–10 s, and some creates and updates returning 503 and failing open.
- The admission controller's `error fetching image` lines were mostly for the platform's own freshly built images, and the controller's slowest StatefulSet writes (5 s and 10 s) match those timeouts.

### Asks

1. Exclude the platform's agent namespaces from inline image scanning at admission, or make the policyeval webhook use only cached image data, with no Sensor or Central scan in the admission path.
2. If inline scanning has to stay: raise the admission-control image cache's size and expiry, and check the Central scan semaphore that times out.
3. Tell us whether the "Block images older than 1 year" policy stays enforced on the agent namespaces: it rejects agent StatefulSets at admission, and the platform now rolls the image back when it does.

## VM runner and harness host directories

The platform's node directories need the SELinux label confined pods can read.
[`99-worker-platform-host-dirs.yaml`](99-worker-platform-host-dirs.yaml) creates and labels them; see the [README](README.md) for what it does and how to roll it out.
