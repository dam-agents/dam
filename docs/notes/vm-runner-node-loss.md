# VM runner node loss — operations

Last verified: 2026-10-19

What to do when the node holding a user's VM runner is gone or not ready.
Every agent of every owner with a runner on that node is down, and it stays down until someone acts here.

## How it shows up

- The `VMRunnerNodeLost` alert fires for a node the cluster has not reported ready for five minutes.
- Each affected agent carries the reason `MachineRunnerNodeLost` on its `PodReady` condition, naming the node, instead of the "still starting" it used to show.
- One Warning Event per affected user, reason `MachineRunnerNodeLost`, on each of their vm Agents: `kubectl get events -n <agent namespace> --field-selector reason=MachineRunnerNodeLost`.
- `kubectl get pods -n <agent namespace> -l app.kubernetes.io/component=vm-runner -o wide` shows the runner pod of an affected owner `Terminating` on the lost node, and its replacement `Pending`.

Read the pod's status and its events.
Do not describe the pod or print its environment — a runner pod carries the owner's credentials as env values.

## Why it does not clear itself

A runner is one replica on a claim only one node may attach, so the replacement pod pends on Multi-Attach for as long as the old pod is still recorded on the dead node.
The controller does not delete that pod.
Two VMMs on one btrfs on a network disk is unrecoverable, and the runner's own host lock holds one node only: a node that cannot see the dead node's lock will boot a second VMM on the same disks.
So the sequence below is a fence first, a pod deletion second, and never the other way round.

## First: is the node coming back?

A kubelet restart, a network partition or a reimage that finishes brings the node back with its pod, and the machines restart on it with nothing lost.
Wait for that if the node is expected back.
The alert clears on its own.

## Otherwise: fence the node, then clear it out of service

1. **Fence it.**
   Stop the machine for good: power it off at the provider, and detach or cut off its storage and network.
   Do not skip this because the node stopped answering — an unreachable node may still run its VMMs.
   Nothing in the platform does this step for you.

2. **Taint it out of service**:

   ```sh
   kubectl taint node <node> node.kubernetes.io/out-of-service=nodeshutdown:NoExecute
   ```

   This is the one sanctioned way to let the cluster drop the pods on a node it cannot reach without grace; the taint also keeps new pods off it.
   The terminating runner pod goes, its claim is released, and the Deployment's replacement pod attaches it on a ready node.

3. **Watch it clear**: the replacement runner pod becomes ready, and the agents of those owners restart and lose `MachineRunnerNodeLost`.
   Every machine of the owner reboots at once, since they are processes of that one pod; their disks are on the claim and are untouched.

4. **Remove the taint** once the node is deleted or has come back and been drained:

   ```sh
   kubectl taint node <node> node.kubernetes.io/out-of-service-
   ```

## What not to do

- **Never `kubectl delete pod --force --grace-period=0` a runner pod**, and never delete its Deployment to break the Multi-Attach deadlock.
  Both do what the taint does without the fence in front of it.
- **Never delete the owner's runner claim** to start clean.
  It holds every machine's disk of that owner and is not backed up, and a deletion is final.
  The taint is enough to get the claim onto another node.
