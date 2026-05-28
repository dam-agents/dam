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
See ADR-047.
*/}}
{{- define "platform.validate.termsRequired" -}}
{{- if not (.Values.terms.text | default "" | trim) -}}
{{- fail "terms.text is required. Supply via `helm install --set-file terms.text=./TERMS.md`. See ADR-047." -}}
{{- end -}}
{{- if not (.Values.terms.version | default "" | trim) -}}
{{- fail "terms.version is required. Bump on material text changes to re-prompt every user. See ADR-047." -}}
{{- end -}}
{{- end -}}
