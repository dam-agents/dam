{{/*
Chart-level validators. Each `platform.validate.*` template either
no-ops or calls `fail` to abort `helm install / upgrade / template`.
The top-level `platform.validate` dispatches to all of them; it is
invoked once from `templates/validate.yaml`.

To add a new validator: define `platform.validate.<name>` here and
add it to the include list in `platform.validate`.
*/}}

{{- define "platform.validate" -}}
{{- include "platform.validate.nonrootRequiresAgentNamespace" . -}}
{{- end -}}

{{/*
The nonroot-v2 RoleBinding is namespaced to `agentNamespace` and grants
SCC access via the `system:serviceaccounts:<agentNamespace>` group.
Both are meaningless if `agentNamespace` is empty: the binding lands
without a namespace, and the group ref matches no SA. Refuse to render.
*/}}
{{- define "platform.validate.nonrootRequiresAgentNamespace" -}}
{{- if and .Values.openshift .Values.openshift.scc .Values.openshift.scc.nonroot .Values.openshift.scc.nonroot.enabled -}}
{{- if not (.Values.agentNamespace | default "" | trim) -}}
{{- fail "openshift.scc.nonroot.enabled=true requires agentNamespace to be set. The RoleBinding is namespace-scoped and grants SCC access via the system:serviceaccounts:<agentNamespace> group; an empty value makes both meaningless." -}}
{{- end -}}
{{- end -}}
{{- end -}}
