{{/*
Chart-level validators. Each `platform.validate.*` template either
no-ops or calls `fail` to abort `helm install / upgrade / template`.
The top-level `platform.validate` dispatches to all of them; it is
invoked once from `templates/validate.yaml`.

To add a new validator: define `platform.validate.<name>` here and
add it to the include list in `platform.validate`.
*/}}

{{- define "platform.validate" -}}
{{- include "platform.validate.anyuidCapNetRequiresAgentNamespace" . -}}
{{- include "platform.validate.vmRunnerNeedsAMemoryLimit" . -}}
{{- include "platform.validate.openShiftSccForPrivilegedVMPieces" . -}}
{{- include "platform.validate.vmRunnersHaveANodeImageCache" . -}}
{{- include "platform.validate.vmValuesTheControllerCanUse" . -}}
{{- include "platform.validate.vmRunnerPodsNeedAReleaseDirectory" . -}}
{{- include "platform.validate.vmValuesThisChartNoLongerReads" . -}}
{{- include "platform.validate.egressLockdownModeExclusive" . -}}
{{- include "platform.validate.termsRequired" . -}}
{{- include "platform.validate.signUps" . -}}
{{- include "platform.validate.enterpriseGitHubNeedsBothHostAndToken" . -}}
{{- include "platform.validate.unenforcedMeshOnlyOnALocalCluster" . -}}
{{- include "platform.validate.gatewayEgressCidrs" . -}}
{{- include "platform.validate.featureModes" . -}}
{{- include "platform.validate.monitoringNeedsTheCollector" . -}}
{{- end -}}

{{/*
The VM pool alerts read what the platform collector exports, and the collector
exists only with clickstack.enabled.
*/}}
{{- define "platform.validate.monitoringNeedsTheCollector" -}}
{{- if and .Values.monitoring.enabled (not .Values.clickstack.enabled) -}}
{{- fail "monitoring.enabled needs clickstack.enabled: the VM pool series are exported by the platform collector, which runs only with ClickStack." -}}
{{- end -}}
{{- end -}}

{{/*
The api-server refuses to start on a feature mode it cannot read.
*/}}
{{- define "platform.validate.featureModes" -}}
{{- range $id, $mode := fromJson (include "platform.featureModes" $) -}}
{{- if not (has $mode (list "off" "experimental" "on")) -}}
{{- fail (printf "features.%s must be off, experimental or on, got %v." $id $mode) -}}
{{- end -}}
{{- end -}}
{{- if not (has (include "platform.featureDefault" .) (list "off" "experimental" "on")) -}}
{{- fail (printf "featureDefault must be off, experimental or on, got %v." .Values.featureDefault) -}}
{{- end -}}
{{- end -}}

{{/*
`featureDefault`, read the way `platform.featureModes` reads each mode.
*/}}
{{- define "platform.featureDefault" -}}
{{- $mode := .Values.featureDefault -}}
{{- if kindIs "bool" $mode -}}
{{- ternary "on" "off" $mode -}}
{{- else -}}
{{- $mode | default "experimental" -}}
{{- end -}}
{{- end -}}

{{/*
`virtualization.runner.seccomp`, read the way `platform.featureModes` reads a
mode: an unquoted `off` arrives as `false`, which `default` would take as unset.
*/}}
{{- define "platform.vmRunner.seccomp" -}}
{{- $mode := .Values.virtualization.runner.seccomp -}}
{{- if kindIs "bool" $mode -}}
{{- ternary "on" "off" $mode -}}
{{- else -}}
{{- $mode | default "enforce" -}}
{{- end -}}
{{- end -}}

{{/*
`features` as JSON. YAML 1.1 reads an unquoted on/off as a boolean, so a
boolean is taken as the mode it was written as.
*/}}
{{- define "platform.featureModes" -}}
{{- $modes := dict -}}
{{- range $id, $mode := .Values.features | default dict -}}
{{- if kindIs "bool" $mode -}}
{{- $_ := set $modes $id (ternary "on" "off" $mode) -}}
{{- else -}}
{{- $_ := set $modes $id $mode -}}
{{- end -}}
{{- end -}}
{{- toJson $modes -}}
{{- end -}}

{{/*
controller.gatewayEgress.extraCidrs opens private ranges to every agent
gateway. The controller renders them into each gateway's NetworkPolicy, which
Kubernetes rejects outright when an entry is not a CIDR — and a rejected policy
fails every agent's reconcile. A /0 entry would reopen every private range the
policy exists to close.
*/}}
{{- define "platform.validate.gatewayEgressCidrs" -}}
{{- $cidr := `^(((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])/([0-9]|[12][0-9]|3[0-2])|[0-9a-fA-F:.]*:[0-9a-fA-F:.]*/([0-9]|[1-9][0-9]|1[01][0-9]|12[0-8]))$` -}}
{{- range ((.Values.controller.gatewayEgress | default dict).extraCidrs | default list) -}}
{{- if not (regexMatch $cidr (toString .)) -}}
{{- fail (printf "controller.gatewayEgress.extraCidrs entry %q is not a CIDR (address/prefix, e.g. 10.20.0.0/16)." (toString .)) -}}
{{- end -}}
{{- if hasSuffix "/0" (toString .) -}}
{{- fail (printf "controller.gatewayEgress.extraCidrs entry %q opens every private range to agent gateways, which is what their egress policy closes. Name the enterprise service's own range instead." (toString .)) -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
istio.enforce=false leaves every AuthorizationPolicy rendered and none
enforced: the api-server trusts the agent ID in a harness URL because the
waypoint admitted only that agent's principal, so without the mesh any pod
can act as any agent. That is acceptable on a developer's own cluster whose
kernel cannot run the ambient dataplane, and nowhere else. The marker is a
ConfigMap only `mise run cluster:install -- --no-mesh` creates, and that task
refuses to run under CI. `lookup` finds nothing during an offline render, so
helm template, a GitOps controller's render and a pipeline's render all fail
here, and so does an install on any cluster nobody provisioned that way.
*/}}
{{- define "platform.validate.unenforcedMeshOnlyOnALocalCluster" -}}
{{- $enforce := .Values.istio.enforce -}}
{{- if not (kindIs "bool" $enforce) -}}
{{- fail (printf "istio.enforce must be true or false, got the %s %q (--set-string and quoted YAML make a string)." (kindOf $enforce) (toString $enforce)) -}}
{{- end -}}
{{- if not $enforce -}}
{{- if not (lookup "v1" "ConfigMap" "kube-system" "platform-local-no-mesh") -}}
{{- fail "istio.enforce=false is local-only: it leaves every AuthorizationPolicy unenforced, so any pod can call the harness as any agent. The chart accepts it only on a cluster provisioned by `mise run cluster:install -- --no-mesh`, which marks the cluster with the kube-system ConfigMap platform-local-no-mesh. It is refused in an offline render (helm template, GitOps) and on every other cluster." -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
The kit reader needs the host and the token together. Rendering one without
the other would drop the pair silently, and every catalog and kit on that
host would then read as a host nobody named — which the refresh settles as
the author withdrawing them, pruning the very rows the setting was added to
serve. Fail at render instead, where the operator is looking.
*/}}
{{- define "platform.validate.enterpriseGitHubNeedsBothHostAndToken" -}}
{{- $ghe := dig "enterprise" dict (.Values.github | default dict) -}}
{{- $named := $ghe.host | default "" | trim -}}
{{- $fallback := dig "oauthAppDefaults" "githubEnterprise" "host" "" .Values.apiServer | trim -}}
{{- $token := $ghe.token | default "" | trim -}}
{{- if and $named (not $token) -}}
{{- fail (printf "github.enterprise.host is %q but github.enterprise.token is empty. The platform cannot read that host without a token, and the kits on it would be pruned rather than held. Set the token, or clear the host." $named) -}}
{{- end -}}
{{- if and $token (not $named) (not $fallback) -}}
{{- fail "github.enterprise.token is set but no enterprise host is. Set github.enterprise.host (or apiServer.oauthAppDefaults.githubEnterprise.host), or clear the token — a token with no host to send it to reads nothing." -}}
{{- end -}}
{{- end -}}

{{/*
The anyuid-cap-net RoleBinding is namespaced to `agentNamespace` and
grants SCC access via the `system:serviceaccounts:<agentNamespace>`
group. Both are meaningless if `agentNamespace` is empty.
*/}}
{{- define "platform.validate.anyuidCapNetRequiresAgentNamespace" -}}
{{- if .Values.openshift.scc.anyuidCapNet.enabled -}}
{{- if not (.Values.agentNamespace | default "" | trim) -}}
{{- fail "openshift.scc.anyuidCapNet.enabled=true requires agentNamespace to be set. The RoleBinding is namespace-scoped and grants SCC access via the system:serviceaccounts:<agentNamespace> group; an empty value makes both meaningless." -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
iptablesInit and npGateInit are the two egress-lockdown modes —
exactly one belongs on a given pod. See values.yaml for the two-mode
comment.
*/}}
{{- define "platform.validate.egressLockdownModeExclusive" -}}
{{- $base := .Values.controller.agent.base -}}
{{- if and $base.iptablesInit $base.iptablesInit.enabled $base.npGateInit $base.npGateInit.enabled -}}
{{- fail "controller.agent.base.iptablesInit.enabled and npGateInit.enabled are mutually exclusive — enable exactly one. See values.yaml for the two-mode comment." -}}
{{- end -}}
{{- end -}}

{{/*
Terms of Use are non-optional — the api-server gate refuses every
authenticated route until each user has accepted the current version.
A missing text or version would lock out every account at first request.
*/}}
{{- define "platform.validate.termsRequired" -}}
{{- if not (.Values.terms.text | default "" | trim) -}}
{{- fail "terms.text is required. Supply via `helm install --set-file terms.text=./TERMS.md`." -}}
{{- end -}}
{{- if not (.Values.terms.version | default "" | trim) -}}
{{- fail "terms.version is required. Bump on material text changes to re-prompt every user." -}}
{{- end -}}
{{- end -}}

{{/*
The api-server refuses to start on any other value, so catch it at install.
*/}}
{{- define "platform.validate.signUps" -}}
{{- if not (has .Values.signUps (list "open" "closed")) -}}
{{- fail (printf "signUps must be \"open\" or \"closed\", got %q." (toString .Values.signUps)) -}}
{{- end -}}
{{- end -}}

{{/*
The runner admits machines against its own memory limit, read through the
downward API. With no limit that reads as the node's allocatable, so the
runner promises machines the whole node while itself being BestEffort and
first evicted — taking every machine with it.
*/}}
{{- define "platform.validate.vmRunnerNeedsAMemoryLimit" -}}
{{- if .Values.virtualization.enabled -}}
{{- $r := .Values.virtualization.runner.resources | default dict -}}
{{- if not (dig "limits" "memory" "" $r) -}}
{{- fail "virtualization.enabled=true requires virtualization.runner.resources.limits.memory. The runner admits machines against that limit; without one it reads the node's allocatable and is BestEffort, so it over-promises memory and is evicted first." -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
On OpenShift the chart's own SCC is the only one the runner gets, and it
admits no hostPath volume. Without a built-in SCC bound as well, admission
refuses the pod. `openshift.scc.anyuidCapNet.enabled` is the chart's existing
signal that this is an OpenShift cluster.
*/}}
{{- define "platform.validate.openShiftSccForPrivilegedVMPieces" -}}
{{- if and .Values.virtualization.enabled .Values.openshift.scc.anyuidCapNet.enabled -}}
{{- $v := .Values.virtualization -}}
{{- if and $v.runner.releaseHostPath (not $v.runner.hostAddress) (not $v.runner.scc) -}}
{{- fail "on OpenShift, virtualization.runner.releaseHostPath needs virtualization.runner.scc — the chart's own agent SCC sets allowHostDirVolumePlugin=false, so it refuses the hostPath volume the runners and the release stager mount, and the stager labels the directory as spc_t. Set an SCC that admits a hostPath and leaves the SELinux type to the pod (seLinuxContext RunAsAny)." -}}
{{- end -}}
{{- if and (not $v.runner.hostAddress) (not $v.runner.scc) -}}
{{- fail "on OpenShift, virtualization.runner.scc is required — the chart's own agent SCC sets allowHostDirVolumePlugin=false, so it refuses the hostPath volume of the node image cache (virtualization.imageCache.hostPath), which every runner and the image cache service mount. Set an SCC that admits a hostPath and leaves the SELinux type to the pod (seLinuxContext RunAsAny), such as hostmount-anyuid." -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
The node image cache is the only place a runner pod gets an image from: its
service is the only writer of the node directory, and the runners mount it
read-only. With no directory named there is no cache and no runner can boot
anything. The Mac's host runner runs outside the cluster with a cache of its own.
*/}}
{{- define "platform.validate.vmRunnersHaveANodeImageCache" -}}
{{- $v := .Values.virtualization -}}
{{- if and $v.enabled (not $v.runner.hostAddress) (not ($v.imageCache | default dict).hostPath) -}}
{{- fail "virtualization.enabled=true requires virtualization.imageCache.hostPath — the node directory the image cache service unpacks every image into, and the only place a runner gets an image from. Set it to a directory on the runner nodes (the default is /var/lib/platform-images; on OpenShift, the one etc/openshift-node-config creates)." -}}
{{- end -}}
{{- end -}}

{{/*
Values the controller would otherwise take in and fail on later, one agent at a
time: a DNS policy the image cache service does not take is refused by
Kubernetes, and a seccomp mode smolvm does not know installs no filter. A budget
that is not a positive quantity refuses every runner.
*/}}
{{- define "platform.validate.vmValuesTheControllerCanUse" -}}
{{- if .Values.virtualization.enabled -}}
{{- $v := .Values.virtualization -}}
{{- if ($v.devicePlugin | default dict).enabled -}}
{{- fail "virtualization.devicePlugin is gone: the chart no longer ships a KVM device plugin, because a plugin is per node and a cluster runs one for every install on it. Run one on the cluster (e.g. squat's generic-device-plugin, as helm/extra/kvm-device-plugin.yaml does for local dev), set virtualization.runner.devices to the resource it publishes (squat.ai/kvm: \"1\"), and drop virtualization.devicePlugin." -}}
{{- end -}}
{{- $dns := ($v.imageCache | default dict).dnsPolicy | default "Default" -}}
{{- if not (has $dns (list "Default" "ClusterFirst")) -}}
{{- fail (printf "virtualization.imageCache.dnsPolicy %q is not one the image cache service supports — use `Default` (the node's resolver) or `ClusterFirst`. See the comment on it in values.yaml for which one." $dns) -}}
{{- end -}}
{{- $seccomp := include "platform.vmRunner.seccomp" . -}}
{{- if not (has $seccomp (list "audit" "enforce" "off")) -}}
{{- fail (printf "virtualization.runner.seccomp %q is not a mode smolvm knows — use `audit`, `enforce` or `off`. smolvm reads any other value as `off`, so a typo would install no filter at all." (toString $seccomp)) -}}
{{- end -}}
{{- $budget := toString (($v.imageCache | default dict).budget | default "") -}}
{{- if not (regexMatch `^[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?(Ki|Mi|Gi|Ti|Pi|Ei|k|M|G|T|P|E)?$` $budget) -}}
{{- fail (printf "virtualization.imageCache.budget %q is not a byte quantity (e.g. 50Gi). It is required: the controller refuses to create a runner without a bound on what the node's cached images may occupy." $budget) -}}
{{- end -}}
{{- if regexMatch `^0*(\.0*)?([eE][+-]?[0-9]+)?[A-Za-z]*$` $budget -}}
{{- fail (printf "virtualization.imageCache.budget %q leaves the cached images no room at all, so no runner can fetch an image. Give it a positive size well under the disk it sits on." $budget) -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
A runner pod takes a new runner image only as a hand-off from the node
directory the release stager writes, so an install with runner pods must name
one. The host runner of a local Mac cluster runs outside any pod and needs
none.
*/}}
{{- define "platform.validate.vmRunnerPodsNeedAReleaseDirectory" -}}
{{- $v := .Values.virtualization -}}
{{- if and $v.enabled (not $v.runner.hostAddress) (not $v.runner.releaseHostPath) -}}
{{- fail "virtualization.runner.releaseHostPath is required with virtualization.enabled: the release stager copies each runner release there, and every runner pod's loader takes a new runner image from it without rebooting a machine (unless that release declares another reboot key than the pod runs: its pods roll, which reboots them). Set it to a node directory such as /var/lib/platform-vm-runner-releases; each install stages into its own subdirectory of it." -}}
{{- end -}}
{{- end -}}

{{/*
Virtualization values the chart no longer reads. Helm keeps a value nothing
reads without a word, so an install that still sets one would be quietly given
something else: the node image cache service can no longer be switched off and
runs where the runners do, the runner admits sources by its NetworkPolicy
alone, every owner's runner runs `runner.image`, and a runner neither caches
on its own claim, resolves any name, nor reaches anything but its gateways.
Fail at render instead, naming what took each one's place.
*/}}
{{- define "platform.validate.vmValuesThisChartNoLongerReads" -}}
{{- $v := .Values.virtualization | default dict -}}
{{- $cache := $v.imageCache | default dict -}}
{{- $runner := $v.runner | default dict -}}
{{- if hasKey $cache "preload" -}}
{{- fail "virtualization.imageCache.preload is no longer read. The node image cache service is the only writer of imageCache.hostPath, so it always runs where that is set, on the runners' own nodeSelector and tolerations; its interval is virtualization.imageCache.preloadInterval and its resources virtualization.imageCache.resources. Remove the preload block." -}}
{{- end -}}
{{- if hasKey $runner "ingressCidrs" -}}
{{- fail "virtualization.runner.ingressCidrs is no longer read. The runner's NetworkPolicy is the only gate on its published ports, admitting the api-server and the controller. Remove the key." -}}
{{- end -}}
{{- if hasKey $runner "releaseSameRuntimeOnly" -}}
{{- fail "virtualization.runner.releaseSameRuntimeOnly is no longer read: a runner release built against another VM runtime is handed off in place (unless it declares another reboot key than the pod runs, which rolls the pods instead), and a machine whose runtime errors, or whose guest goes quiet, is rebooted onto the runner's own runtime. To leave the new runtime, configure the previous runner image again. Remove the key." -}}
{{- end -}}
{{- if or (hasKey $runner "dnsCidrs") (hasKey $runner "clusterDns") -}}
{{- fail "virtualization.runner.dnsCidrs and virtualization.runner.clusterDns are no longer read. A runner never resolves a name: the node image cache service (virtualization.imageCache) fetches every image, so the runner's NetworkPolicy admits no resolver. Remove the keys." -}}
{{- end -}}
{{- if hasKey $runner "dnsPolicy" -}}
{{- fail "virtualization.runner.dnsPolicy is no longer read. A runner never resolves a name; the image cache service, which fetches every image, takes virtualization.imageCache.dnsPolicy instead. Move the value there." -}}
{{- end -}}
{{- if or (hasKey $runner "egressCidrs") (hasKey $runner "egressExceptCidrs") -}}
{{- fail "virtualization.runner.egressCidrs and virtualization.runner.egressExceptCidrs are no longer read. A runner dials nothing but its owner's gateways, so its NetworkPolicy admits those alone, always. Remove the keys." -}}
{{- end -}}
{{- if hasKey $runner "imageArchiveHostPath" -}}
{{- fail "virtualization.runner.imageArchiveHostPath is no longer read. Staged image trees live in the node image cache directory (virtualization.imageCache.hostPath), beside the trees its service fetches; `mise run image:stage-vm` stages there. Remove the key, or move its directory to imageCache.hostPath." -}}
{{- end -}}{{- if or (hasKey $runner "canaryImage") (hasKey $runner "canary") -}}
{{- fail "virtualization.runner.canaryImage and virtualization.runner.canary are no longer read: every runner runs virtualization.runner.image, rolled across owners by virtualization.runner.rollout. Remove the keys." -}}
{{- end -}}
{{- end -}}
