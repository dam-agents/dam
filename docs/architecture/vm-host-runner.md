# VM host runner

Last verified: 2026-10-20

On a Mac, the local cluster's `vm` Backend runs on **one runner outside the cluster**, on the Mac's own hypervisor, instead of on the per-owner [runner pods](vm-runner.md) inside the cluster's VM, which would need a hypervisor nested in that VM.
A nested guest boots several times slower, a busy laptop pushes it past smolvm's fixed ready window, and only recent Apple chips nest at all.
The host runner is the same vm-runner and machine API, built for the Mac.
It is a local-development shape only: an install turns it on by naming the address pods reach the Mac at (`virtualization.runner.hostAddress`), and `cluster:install` does so on a Mac unless told to nest.
`cluster:install` turns the `vm` Backend on by default on an Apple silicon Mac, so a local cluster there runs this runner unless the install turns the Backend off.

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
With the [owner gateway](credential-gateway.md#owner-gateway) on, the NodePort follows the agent's Service onto its slot on the owner's gateway pod, so nothing else changes here.
The guest's proxy is smolvm's gateway address, which smolvm relays to the host's loopback.
Allowing that address would open every loopback port: other machines' published ports, the runner's API, and whatever the user runs locally.
So the machine is given its gateway's loopback port in place of an allowlist.
Its VMM maps that one port and denies every other destination, and answers DNS itself, relaying none: the Mac's loopback often runs a resolver of its own.
So a guest resolves no name but its gateway's own, and a tool without proxy settings has no way out, unlike on a [runner in the cluster](vm-runner.md).
Both sides hold the gateway address to the [guest contract](../../packages/vm-runner/contract/).
No kernel gate stands behind that smolvm filter, since a Mac process has no NetworkPolicy.
And the forwarded NodePort is open to any process on the Mac, which can use a gateway's credentials: the same trust as the laptop's own user.

**The VMM library is the release's, at the link and at the load.** The host runner links libkrun, the library smolvm boots a machine with, so the build links the copy in the pinned smolvm release and records a loader path to the copy the install stages beside the binary.
smolvm loads that same copy at run time, and no other.
A build that could reach a system-wide copy would record that one instead, leaving a runner that starts only while the copy is where it was, so the build refuses a binary whose loader would search the system for one.

**Images and disks.** The host runner is the one runner with no node image cache: no cache service runs beside it, so it fetches nothing from a registry and boots only the image trees the install stages onto a case-sensitive volume it owns.
The Mac's default filesystem folds names that differ only in case into one file, and agent images carry such names.
Trees are unpacked without privilege, so a guest sees every image file owned by the runner's user rather than by the image's owners.
The runner makes a new disk btrfs from the runner image's template ([vm-runner](vm-runner.md)), which needs no filesystem tool on the Mac.
platform-init and the guest kernel are the runner image's, so the Mac's guests mount btrfs as the pods' do: the image build in the cluster's VM leaves its kernel wrapped for macOS, and `cluster:host-runner` compiles that into the release's libkrunfw.

**Machines live under a short directory of their own.** smolvm keeps each machine's disks, record and sockets at a fixed depth under the runner's HOME, and a Mac holds a unix socket path to 103 bytes.
The runner's own directory is too long for that, so the install starts the runner under a short directory in the user's home, and moves machines from before this layout there once.
The runner refuses to start under a HOME whose machine sockets would not fit, naming the path and the limit: a boot under it fails only with the hypervisor rejecting its configuration.

**Lifecycle.** The runner is a process on the Mac, not a supervised service.
Stopping it stops its machines, as a pod's termination does; the controller's sweep starts them again once the runner is back.
`cluster:stop` of the cluster that last started it stops it; `cluster:delete` also removes its machines.
Nothing restarts it after the Mac reboots: `cluster:host-runner` (re)starts it.
There is one host runner per Mac, serving the cluster that started it last.
A Mac has no `/proc`, so the runner finds a VMM that outlived its stop by scanning the kernel's process list and reading each process's arguments, and powers it off as it would in a pod.
It asks the kernel for the processes of the user it runs as, since a VMM is its own child and a process of another user is no VMM of this machine, and it reads a whole listing or none: the kernel keeps its own snapshot of the table and answers a prefix of it without an error, so a listing that fills the room it was given, or that a second listing of the same room disagrees with, is read again with more room.
A process installing a new image answers no arguments, or an error, for the moment the kernel takes to swap them — the read is EIO for the copy it cannot make and EINVAL while the new task is not reachable yet — and every VMM is in that moment at its start, so the runner reads it again instead of taking it for gone, as it does for any read that failed while the process was still there.
The kernel counts each image install as a new name for the process, so the arguments and the name a signal goes through are taken together and the whole look is retried while the process installs one: a name taken before the read and one taken after it must be the same, or the arguments belong to one of the process's images and the name to the other.
An answer is read only when its argument count and every argument it counts are all there, and the arguments start exactly where the kernel's own padding of the executable's path ends, so a process's environment is never read as its arguments and named as a VMM the runner then kills.
A scan that could not look is an error and never an empty answer, and only a look that described every process of the user says a machine is free: one that left a process the kernel would not describe says so, and a start that met no such look in its whole wait fails instead of booting beside a VMM it could not see.
A process the scan found is asked after at the kernel too, since a `/proc` a Mac may have mounted is a view the kernel's own table need not agree with, and a pid missing from it would read as an exited VMM while the kernel still holds it.
The runner kills a VMM by the name the kernel gave that process, never by its number: a number whose process has exited can belong to another process by the time a sweep reaches it, and the kernel refuses a name whose process is gone.
A name the kernel refuses has left the process it was taken for — the process exited, or it installed a new image — so the runner looks at the process again and repeats the signal while its arguments still name the machine, and leaves it alone once it is gone or no longer matches.
A process the runner cannot name at all, which a policy may deny, is matched but never signalled: it is counted among the processes a look did not see through, since a number alone is not a process a sweep may end.
Runner pods an install ran before it switched to the host runner are left as they are, neither restarted nor removed: nothing schedules them, and their claims hold those owners' old machine disks, so an operator deletes them once nothing on those disks is wanted.
