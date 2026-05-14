{{/*
Chart-level validators. Each `platform.validate.*` template either
no-ops or calls `fail` to abort `helm install / upgrade / template`.
The top-level `platform.validate` dispatches to all of them; it is
invoked once from `templates/validate.yaml`.

To add a new validator: define `platform.validate.<name>` here and
add it to the include list in `platform.validate`.
*/}}

{{- define "platform.validate" -}}
{{- include "platform.validate.nonrootCapNetRequiresAgentNamespace" . -}}
{{- end -}}

{{/*
The nonroot-cap-net RoleBinding is namespaced to `agentNamespace` and
grants SCC access via the `system:serviceaccounts:<agentNamespace>`
group. Both are meaningless if `agentNamespace` is empty.
*/}}
{{- define "platform.validate.nonrootCapNetRequiresAgentNamespace" -}}
{{- if and .Values.openshift .Values.openshift.scc .Values.openshift.scc.nonrootCapNet .Values.openshift.scc.nonrootCapNet.enabled -}}
{{- if not (.Values.agentNamespace | default "" | trim) -}}
{{- fail "openshift.scc.nonrootCapNet.enabled=true requires agentNamespace to be set. The RoleBinding is namespace-scoped and grants SCC access via the system:serviceaccounts:<agentNamespace> group; an empty value makes both meaningless." -}}
{{- end -}}
{{- end -}}
{{- end -}}
