{{/*
Chart-level validators. Each `platform.validate.*` template either
no-ops or calls `fail` to abort `helm install / upgrade / template`.
The top-level `platform.validate` dispatches to all of them; it is
invoked once from `templates/validate.yaml`.

To add a new validator: define `platform.validate.<name>` here and
add it to the include list in `platform.validate`.
*/}}

{{- define "platform.validate" -}}
{{- include "platform.validate.anyuidRequiresKata" . -}}
{{- end -}}

{{/*
Granting `system:openshift:scc:anyuid` lets agent containers run as
UID 0. That is only acceptable when the workload is isolated inside a
kata-containers microVM — "root" is then guest-VM root, not host root.
Without kata, anyuid lands the agent at UID 0 on the host's default
OCI runtime, which defeats the sandbox boundary the platform relies on.
*/}}
{{- define "platform.validate.anyuidRequiresKata" -}}
{{- if and .Values.openshift .Values.openshift.scc .Values.openshift.scc.anyuid .Values.openshift.scc.anyuid.enabled -}}
{{- $rc := "" -}}
{{- if and .Values.controller .Values.controller.agent .Values.controller.agent.base -}}
{{- $rc = .Values.controller.agent.base.runtimeClassName | default "" -}}
{{- end -}}
{{- if not (hasPrefix "kata" $rc) -}}
{{- fail (printf "openshift.scc.anyuid.enabled=true requires controller.agent.base.runtimeClassName to be a kata runtime (got %q). Granting anyuid without kata isolation puts agents at UID 0 on the host's default OCI runtime." $rc) -}}
{{- end -}}
{{- end -}}
{{- end -}}
