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
escaped guest would own. The runner's own NetworkPolicy is the kernel gate on
where such a guest may go (each gateway's ingress policy separately decides whose
credentials it can reach), and it cannot default to closed because the runner
pulls agent images — so an install has to say, rather than inherit an open pod
by omission.
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
