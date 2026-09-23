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
{{- include "platform.validate.vmRunnerNeedsAnEgressDecision" . -}}
{{- include "platform.validate.openShiftSccForPrivilegedVMPieces" . -}}
{{- include "platform.validate.oneBackingForTheRunnerImages" . -}}
{{- include "platform.validate.vmValuesTheControllerCanUse" . -}}
{{- include "platform.validate.egressLockdownModeExclusive" . -}}
{{- include "platform.validate.termsRequired" . -}}
{{- end -}}

{{/*
The anyuid-cap-net RoleBinding is namespaced to `agentNamespace` and
grants SCC access via the `system:serviceaccounts:<agentNamespace>`
group. Both are meaningless if `agentNamespace` is empty.
*/}}
{{- define "platform.validate.anyuidCapNetRequiresAgentNamespace" -}}
{{- if and .Values.openshift .Values.openshift.scc .Values.openshift.scc.anyuidCapNet .Values.openshift.scc.anyuidCapNet.enabled -}}
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
A machine's egress allowlist is enforced by smolvm inside the very process an
escaped guest would own. The runner's own NetworkPolicy is the only gate behind
it, and it cannot default to closed because the runner pulls agent images — so
an install has to say, rather than inherit an open pod by omission.
*/}}
{{- define "platform.validate.vmRunnerNeedsAnEgressDecision" -}}
{{- if .Values.virtualization.enabled -}}
{{- if not .Values.virtualization.runner.egressCidrs -}}
{{- fail "virtualization.enabled=true requires virtualization.runner.egressCidrs — the only kernel gate behind a guest's own egress allowlist. See virtualization.runner.egressCidrs in values.yaml for what to set; to leave the runner unconfined, say so out loud with [0.0.0.0/0] and no exceptions." -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
On OpenShift the chart's own SCC is the only one the runner and the device
plugin get, and it admits neither a privileged container nor a hostPath
volume. Without a built-in SCC bound as well, admission refuses the pod and
the failure is silent where it hurts most: a rejected device plugin advertises
no KVM resource, so every runner pod pends forever on a resource nothing will
ever publish. `openshift.scc.anyuidCapNet.enabled` is the chart's existing
signal that this is an OpenShift cluster.
*/}}
{{- define "platform.validate.openShiftSccForPrivilegedVMPieces" -}}
{{- if and .Values.virtualization.enabled .Values.openshift.scc.anyuidCapNet.enabled -}}
{{- $v := .Values.virtualization -}}
{{- if and $v.devicePlugin.enabled (not $v.devicePlugin.scc) -}}
{{- fail "on OpenShift, virtualization.devicePlugin.enabled=true requires virtualization.devicePlugin.scc (the plugin runs privileged with the kubelet's device-plugin socket and /dev). Set it to `privileged`, or the DaemonSet never admits, advertises no KVM resource, and every VM runner pod pends forever." -}}
{{- end -}}
{{- if and $v.runner.imageArchiveHostPath (not $v.runner.scc) -}}
{{- fail "on OpenShift, virtualization.runner.imageArchiveHostPath needs virtualization.runner.scc — the chart's own agent SCC sets allowHostDirVolumePlugin=false, so it refuses the hostPath volume that value mounts. Set an SCC that admits a hostPath, or drop imageArchiveHostPath and give the runner a registry to pull from." -}}
{{- end -}}
{{- if and ($v.imageCache | default dict).hostPath (not $v.runner.scc) -}}
{{- fail "on OpenShift, virtualization.imageCache.hostPath needs virtualization.runner.scc — the chart's own agent SCC sets allowHostDirVolumePlugin=false, so it refuses the hostPath volume the node cache mounts. Set an SCC that admits a hostPath, or clear imageCache.hostPath and let each runner cache on its own claim." -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
Both values back the same directory in the runner — the node cache the runners
on a node write to, the archive path a read-only directory staged on the host —
and only one volume can be mounted there. Rather than silently preferring one,
say so.
*/}}
{{- define "platform.validate.oneBackingForTheRunnerImages" -}}
{{- if .Values.virtualization.enabled -}}
{{- $v := .Values.virtualization -}}
{{- if and ($v.imageCache | default dict).hostPath $v.runner.imageArchiveHostPath -}}
{{- fail "virtualization.imageCache.hostPath and virtualization.runner.imageArchiveHostPath both back the runner's image directory, and only one can be mounted there. Keep the node cache the runners fetch into, or keep the read-only archives staged for an install with no registry." -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
Values the controller would otherwise take in and fail on later, one agent at a
time: a range that is not a CIDR makes Kubernetes reject the runner's
NetworkPolicy on every reconcile, and an exception that is not one is dropped
without a word, leaving the range it was meant to close open. A DNS policy
other than the two the runner supports is silently read as `Default`. A budget
that is not a positive quantity refuses every runner. A device plugin with no
grants advertises nothing, so every runner pends. `0.0.0.0/0` with no
exceptions is not refused here: the values name it as the way to leave the
runner unconfined on purpose, and the controller warns about it at startup.
*/}}
{{- define "platform.validate.vmValuesTheControllerCanUse" -}}
{{- if .Values.virtualization.enabled -}}
{{- $v := .Values.virtualization -}}
{{- $cidr := `^(((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])/([0-9]|[12][0-9]|3[0-2])|[0-9a-fA-F:.]*:[0-9a-fA-F:.]*/([0-9]|[1-9][0-9]|1[01][0-9]|12[0-8]))$` -}}
{{- range $field := list "egressCidrs" "egressExceptCidrs" "ingressCidrs" -}}
{{- range (index $v.runner $field | default list) -}}
{{- if not (regexMatch $cidr (toString .)) -}}
{{- fail (printf "virtualization.runner.%s entry %q is not a CIDR (address/prefix, e.g. 10.128.0.0/14). The controller renders these into the runner's NetworkPolicy, which Kubernetes rejects outright — and an exception it cannot read is dropped, leaving open the range it was meant to close." $field (toString .)) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- $dns := $v.runner.dnsPolicy | default "Default" -}}
{{- if not (has $dns (list "Default" "ClusterFirst")) -}}
{{- fail (printf "virtualization.runner.dnsPolicy %q is not one the runner supports — use `Default` (the node's resolver) or `ClusterFirst`. See the comment on it in values.yaml for which one." $dns) -}}
{{- end -}}
{{- $budget := toString (($v.imageCache | default dict).budget | default "") -}}
{{- if not (regexMatch `^[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?(Ki|Mi|Gi|Ti|Pi|Ei|k|M|G|T|P|E)?$` $budget) -}}
{{- fail (printf "virtualization.imageCache.budget %q is not a byte quantity (e.g. 50Gi). It is required: the controller refuses to create a runner without a bound on what its cached images may occupy." $budget) -}}
{{- end -}}
{{- if regexMatch `^0*(\.0*)?([eE][+-]?[0-9]+)?[A-Za-z]*$` $budget -}}
{{- fail (printf "virtualization.imageCache.budget %q leaves the cached images no room at all, so no runner can fetch an image. Give it a positive size well under the disk it sits on." $budget) -}}
{{- end -}}
{{- if and $v.devicePlugin.enabled (lt (int $v.devicePlugin.count) 1) -}}
{{- fail "virtualization.devicePlugin.count must be at least 1 — it is how many VM runners a node may host, and with none the plugin advertises no device and every runner pends." -}}
{{- end -}}
{{- end -}}
{{- end -}}
