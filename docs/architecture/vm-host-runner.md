# VM host runner

Last verified: 2026-10-16

On a Mac, the local cluster's `vm` Backend runs on **one runner outside the cluster**, on the Mac's own hypervisor, instead of on the per-owner [runner pods](vm-runner.md) inside the cluster's VM, which would need a hypervisor nested in that VM.
A nested guest boots several times slower, a busy laptop pushes it past smolvm's fixed ready window, and only recent Apple chips nest at all.
The host runner is the same vm-runner and machine API, built for the Mac.
It is a local-development shape only: an install turns it on by naming the address pods reach the Mac at (`virtualization.runner.hostAddress`), and `cluster:install` does so on a Mac unless told to nest.

**One runner serves every owner.** There is no per-owner boundary.
A guest that escapes its hypervisor reaches every owner's machines and the Mac itself, as the user who started the runner.
The controller builds no runner objects: no Deployment, claim, Service, NetworkPolicy, roll or memory resize.
It writes only the one usage Secret the api-server reads the runner's use with, naming no owner, so every owner's resource bars show the whole laptop's memory, storage and CPU, with each of their own agents as a segment, its VMM's memory and CPU read from the kernel's task info since a Mac has no `/proc`.
The controller still counts memory against the chart's limit rather than the runner's own share, so the runner refuses a machine that does not fit, but nothing hibernates idle agents to make room.
The chart renders the runner's token and asks cert-manager for its serving certificate, which names the host address.
The install copies both to the Mac and starts the runner.
The controller trusts it through the runners' CA as it trusts a pod, and counts it ready as soon as it answers.
A runner that is down fails each machine's ensure as unreachable.
The orphan sweep collects machines that no Agent names, and any runner Deployment left from an install that ran runner pods, keeping its claim, which holds those machines' disks; the host runner itself is never removed.
A renewed certificate does not reach the Mac's copy, so the certificate is issued to outlast a dev cluster.

**The cluster reaches the machines on the Mac's loopback.** The runner listens, and publishes each machine, only on loopback, so nothing on the LAN reaches them.
The cluster VM's user-mode network relays the host address to that loopback.
An agent's Service has no runner pod to select.
The controller writes the Service's own endpoints instead: the host address and the port this machine publishes.
A runtime migration's copy Job reaches the runner the same way, pinned by address rather than by pod selector.

**A machine reaches its gateway through a NodePort.** Guest egress leaves from the Mac, where a gateway's ClusterIP does not route.
The controller exposes each vm Agent's gateway as a NodePort, and the cluster's VM forwards NodePorts to the Mac's loopback.
The guest's proxy is smolvm's gateway address, which smolvm relays to the host's loopback.
Allowing that address would open every loopback port: other machines' published ports, the runner's API, and whatever the user runs locally.
So the machine is given its gateway's loopback port in place of an allowlist.
Its VMM maps that one port and denies every other destination, and answers DNS itself, relaying none: the Mac's loopback often runs a resolver of its own.
So a guest resolves no name but its gateway's own, and a tool without proxy settings has no way out, unlike on a [runner in the cluster](vm-runner.md).
Both sides hold the gateway address to the [guest contract](../../packages/vm-runner/contract/).
No kernel gate stands behind that smolvm filter, since a Mac process has no NetworkPolicy.
And the forwarded NodePort is open to any process on the Mac, which can use a gateway's credentials: the same trust as the laptop's own user.

**Images and disks.** With no registry, the install stages image trees onto a case-sensitive volume the runner owns.
The harness tools the default image boots with are installed on the k3s node, which this runner does not see, so starting the runner waits for that install and copies the node's directory onto a second such volume, adding new versions beside the old ones.
The Mac's default filesystem folds names that differ only in case into one file, and agent images carry such names.
Trees are unpacked without privilege, so a guest sees every image file owned by the runner's user rather than by the image's owners.
The runner makes a new disk btrfs from the runner image's template ([vm-runner](vm-runner.md)), which needs no filesystem tool on the Mac.
`PLATFORM_CONVERT_EXT4_DISKS=1 mise run cluster:host-runner` starts it converting its machines' ext4 disks to btrfs, as `virtualization.runner.convertExt4Disks` does for the runner pods ([vm-runner](vm-runner.md)).
platform-init and the guest kernel are the runner image's, so the Mac's guests mount btrfs as the pods' do: the image build in the cluster's VM leaves its kernel wrapped for macOS, and `cluster:host-runner` compiles that into the release's libkrunfw.

**Lifecycle.** The runner is a process on the Mac, not a supervised service.
Stopping it stops its machines, as a pod's termination does; the controller's sweep starts them again once the runner is back.
`cluster:stop` of the cluster that last started it stops it; `cluster:delete` also removes its machines.
Nothing restarts it after the Mac reboots: `cluster:host-runner` (re)starts it.
There is one host runner per Mac, serving the cluster that started it last.
A Mac has no `/proc`, so the runner finds a VMM that outlived its stop through the kernel's process list and each process's arguments, and powers it off as it would in a pod.
Runner pods an install ran before it switched to the host runner are left as they are, neither restarted nor removed: nothing schedules them, and their claims hold those owners' old machine disks, so an operator deletes them once nothing on those disks is wanted.
