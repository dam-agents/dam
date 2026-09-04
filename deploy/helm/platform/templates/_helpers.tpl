{{/*
Expand the name of the chart.
*/}}
{{- define "platform.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "platform.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "platform.labels" -}}
helm.sh/chart: {{ include "platform.chart" . }}
{{ include "platform.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "platform.selectorLabels" -}}
app.kubernetes.io/name: {{ include "platform.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Chart label
*/}}
{{- define "platform.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
imagePullSecrets — renders the imagePullSecrets list if non-empty.
*/}}
{{- define "platform.imagePullSecrets" -}}
{{- with .Values.imagePullSecrets }}
imagePullSecrets:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end }}

{{/*
podAnnotations — merged pod-template annotations for a workload. This is the
hook OpenTelemetry auto-instrumentation and similar injection operators key
off of. Precedence, highest first: chart-internal (e.g. config checksums that
must survive so a `helm upgrade` rolls the pod) > per-component
(`<component>.podAnnotations`) > chart-wide (`.Values.commonPodAnnotations`).
Renders an `annotations:` block, or nothing when the merged map is empty.

Usage:
  {{- include "platform.podAnnotations" (dict "root" $ "component" .Values.apiServer "internal" $checksums) | nindent 6 }}
  - root:      root context ($), for the chart-wide defaults
  - component: component values subtree (may define `.podAnnotations`); optional
  - internal:  chart-managed annotations that must always render; optional
*/}}
{{- define "platform.podAnnotations" -}}
{{- $component := .component | default dict -}}
{{- $internal := .internal | default dict -}}
{{- $merged := merge (deepCopy $internal) ($component.podAnnotations | default dict) (.root.Values.commonPodAnnotations | default dict) -}}
{{- with $merged }}
annotations:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end }}

{{/*
annotations — merged workload object-metadata annotations (on the
Deployment/StatefulSet/Job itself). Precedence, highest first: chart-internal
(e.g. Helm hook directives) > per-component (`<component>.annotations`) >
chart-wide (`.Values.commonAnnotations`). Renders an `annotations:` block, or
nothing when the merged map is empty. Same `dict` arguments as
`platform.podAnnotations`, reading `.annotations` instead of `.podAnnotations`.
*/}}
{{- define "platform.annotations" -}}
{{- $component := .component | default dict -}}
{{- $internal := .internal | default dict -}}
{{- $merged := merge (deepCopy $internal) ($component.annotations | default dict) (.root.Values.commonAnnotations | default dict) -}}
{{- with $merged }}
annotations:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end }}

{{/*
nameList — comma-separated .name values from a list of objects.
Usage: {{ include "platform.nameList" .Values.someList }}
*/}}
{{- define "platform.nameList" -}}
{{- $names := list }}
{{- range . }}
{{- $names = append $names .name }}
{{- end }}
{{- join "," $names }}
{{- end }}

{{/* ---- Public URLs (derived from domain + port + scheme) ---- */}}

{{/*
Host:port string for URLs (includes port if non-empty)
*/}}
{{- define "platform.hostport" -}}
{{- if .Values.port }}
{{- printf "%s:%v" .Values.domain .Values.port }}
{{- else }}
{{- .Values.domain }}
{{- end }}
{{- end }}

{{- /* Path-based ingress rule block reused per host. `/api` goes to the
       api-server, everything else to the UI. Order matters: more-specific
       Prefix first. Pass `dict "uiSvc" $uiSvc "apiSvc" $apiSvc`. */ -}}
{{- define "platform.ingress.appPaths" -}}
- path: /api
  pathType: Prefix
  backend:
    service:
      name: {{ .apiSvc }}
      port:
        name: http
- path: /
  pathType: Prefix
  backend:
    service:
      name: {{ .uiSvc }}
      port:
        name: http
{{- end }}

{{- /* Single app URL — UI and API share a host (path-based ingress).
       `urls.ui` overrides; `urls.api` is honored as a back-compat fallback. */ -}}
{{- define "platform.url.ui" -}}
{{- if .Values.urls.ui }}
{{- .Values.urls.ui }}
{{- else if .Values.urls.api }}
{{- .Values.urls.api }}
{{- else }}
{{- printf "%s://%s" .Values.scheme (include "platform.hostport" .) }}
{{- end }}
{{- end }}

{{- define "platform.url.keycloak" -}}
{{- if .Values.urls.keycloak }}
{{- .Values.urls.keycloak }}
{{- else }}
{{- printf "%s://keycloak.%s" .Values.scheme (include "platform.hostport" .) }}
{{- end }}
{{- end }}

{{- /* Public share host serving artifact-library content. A dedicated origin
       by design: user-generated content must never share the app origin's
       cookies/tokens. Routed to the api-server (host-gated there). */ -}}
{{- define "platform.url.share" -}}
{{- if .Values.urls.share }}
{{- .Values.urls.share }}
{{- else }}
{{- printf "%s://share.%s" .Values.scheme (include "platform.hostport" .) }}
{{- end }}
{{- end }}

{{/*
Extract just the hostname (no scheme, no port, no path) from a URL.
Usage: {{ include "platform.url.host" (include "platform.url.ui" .) }}
*/}}
{{- define "platform.url.host" -}}
{{- $u := . | trimPrefix "https://" | trimPrefix "http://" -}}
{{- $u = regexReplaceAll "/.*$" $u "" -}}
{{- regexReplaceAll ":[0-9]+$" $u "" -}}
{{- end }}

{{/* ---- Shared PostgreSQL ---- */}}

{{/*
Shared PostgreSQL fullname (StatefulSet + Service)
*/}}
{{- define "platform.postgres.fullname" -}}
{{- printf "%s-postgres" (include "platform.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Shared PostgreSQL secrets name
*/}}
{{- define "platform.postgres.secrets.fullname" -}}
{{- printf "%s-postgres-secrets" (include "platform.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* ---- Shared Redis ---- */}}

{{/*
Shared Redis fullname (StatefulSet + Service)
*/}}
{{- define "platform.redis.fullname" -}}
{{- printf "%s-redis" (include "platform.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Redis URL exposed to consumers. With the bundled Redis disabled, an external
URL must be provided — silently pointing at a non-existent bundled Service
was the old failure mode.
*/}}
{{- define "platform.redis.url" -}}
{{- if .Values.redis.enabled }}
{{- printf "redis://%s:%d" (include "platform.redis.fullname" .) (int .Values.redis.port) }}
{{- else }}
{{- required "redis.externalUrl is required when redis.enabled=false" .Values.redis.externalUrl }}
{{- end }}
{{- end }}

{{/* ---- Shared SeaweedFS (object store) ---- */}}

{{/*
Shared SeaweedFS fullname (StatefulSet + Service)
*/}}
{{- define "platform.seaweedfs.fullname" -}}
{{- printf "%s-seaweedfs" (include "platform.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Shared SeaweedFS secrets name
*/}}
{{- define "platform.seaweedfs.secrets.fullname" -}}
{{- printf "%s-seaweedfs-secrets" (include "platform.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Whether any object store is configured (external endpoint or shared
seaweedfs). Renders "true" or "" — use in `if` conditions.
*/}}
{{- define "platform.objectstorage.enabled" -}}
{{- if or .Values.apiServer.objectStorage.endpoint .Values.seaweedfs.enabled -}}true{{- end -}}
{{- end }}

{{/*
Object-storage endpoint — uses external endpoint if set, otherwise shared
seaweedfs (mirrors platform.apiserver.db.host).
*/}}
{{- define "platform.objectstorage.endpoint" -}}
{{- if .Values.apiServer.objectStorage.endpoint }}
{{- .Values.apiServer.objectStorage.endpoint }}
{{- else }}
{{- printf "http://%s:8333" (include "platform.seaweedfs.fullname" .) }}
{{- end }}
{{- end }}

{{/*
Object-storage endpoint as agents dial it — upload links are signed against
this authority (SigV4 binds the Host header).
*/}}
{{- define "platform.objectstorage.agentEndpoint" -}}
{{- if .Values.apiServer.objectStorage.agentEndpoint }}
{{- .Values.apiServer.objectStorage.agentEndpoint }}
{{- else if .Values.apiServer.objectStorage.endpoint }}
{{- .Values.apiServer.objectStorage.endpoint }}
{{- else }}
{{- printf "http://%s.%s.svc.cluster.local:8333" (include "platform.seaweedfs.fullname" .) .Release.Namespace }}
{{- end }}
{{- end }}

{{/*
Whether the api-server gets static object-store credentials from a
chart-managed Secret: external keys when provided, else the shared
seaweedfs identity (external endpoint with no keys = SDK provider chain).
*/}}
{{- define "platform.objectstorage.hasCredentials" -}}
{{- if .Values.apiServer.objectStorage.endpoint -}}
{{- if .Values.apiServer.objectStorage.accessKeyId -}}true{{- end -}}
{{- else if .Values.seaweedfs.enabled -}}true{{- end -}}
{{- end }}

{{/*
Object-store credentials Secret name — uses the api-server's own secret when
external keys are set, else the shared seaweedfs secret (mirrors
platform.apiserver.db.password.secretName).
*/}}
{{- define "platform.apiserver.objectstorage.credentials.secretName" -}}
{{- if .Values.apiServer.objectStorage.accessKeyId }}
{{- include "platform.apiserver.secrets.fullname" . }}
{{- else }}
{{- include "platform.seaweedfs.secrets.fullname" . }}
{{- end }}
{{- end }}

{{/*
host:port the gateway Envoy pins its object-store routes to — only for a
plain-HTTP agent endpoint (an https store rides the TLS catch-all instead).
The endpoint must carry an explicit port for the exact :authority match.
*/}}
{{- define "platform.objectstorage.agentAuthorityHttp" -}}
{{- $ep := include "platform.objectstorage.agentEndpoint" . }}
{{- if and (include "platform.objectstorage.enabled" .) (hasPrefix "http://" $ep) }}
{{- trimPrefix "http://" $ep | trimSuffix "/" }}
{{- end }}
{{- end }}

{{/*
API Server database host — uses external host if set, otherwise shared postgres
*/}}
{{- define "platform.apiserver.db.host" -}}
{{- if .Values.apiServer.db.host }}
{{- .Values.apiServer.db.host }}
{{- else }}
{{- include "platform.postgres.fullname" . }}
{{- end }}
{{- end }}

{{/*
API Server secrets name — chart-managed Secret holding the external DB password
*/}}
{{- define "platform.apiserver.secrets.fullname" -}}
{{- printf "%s-apiserver-secrets" (include "platform.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
API Server database password secret name — uses shared postgres secret when db.password is empty
*/}}
{{- define "platform.apiserver.db.password.secretName" -}}
{{- if .Values.apiServer.db.password }}
{{- include "platform.apiserver.secrets.fullname" . }}
{{- else }}
{{- include "platform.postgres.secrets.fullname" . }}
{{- end }}
{{- end }}

{{/*
API Server PostgreSQL DSN. When db.sslmode is set the connection is encrypted.
A custom CA (db.caCert) reaches the api-server via DATABASE_CA_CERT_PATH (the DB
client passes it as `ssl.ca`), not the DSN, because postgres-js does not read
sslrootcert from the connection string.
*/}}
{{- define "platform.apiserver.postgres.dsn" -}}
{{- $dsn := printf "postgresql://%s:$(POSTGRES_PASSWORD)@%s:%v/%s" .Values.apiServer.db.user (include "platform.apiserver.db.host" .) (int .Values.apiServer.db.port) .Values.apiServer.db.database -}}
{{- if .Values.apiServer.db.sslmode -}}
{{- $dsn = printf "%s?sslmode=%s" $dsn .Values.apiServer.db.sslmode -}}
{{- end -}}
{{- $dsn -}}
{{- end }}

{{/*
Keycloak OIDC issuer URL (external, for iss claim matching in JWTs)
*/}}
{{- define "platform.keycloak.issuer" -}}
{{- printf "%s/realms/%s" (include "platform.url.keycloak" .) .Values.keycloak.realm }}
{{- end }}

{{/* ---- Keycloak resources ---- */}}

{{/*
Keycloak app name (Deployment + Service)
*/}}
{{- define "platform.keycloak.fullname" -}}
{{- printf "%s-keycloak" (include "platform.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Keycloak secrets name (admin password)
*/}}
{{- define "platform.keycloak.secrets.fullname" -}}
{{- printf "%s-keycloak-secrets" (include "platform.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Keycloak database host — uses external host if set, otherwise shared postgres
*/}}
{{- define "platform.keycloak.db.host" -}}
{{- if .Values.keycloak.db.host }}
{{- .Values.keycloak.db.host }}
{{- else }}
{{- include "platform.postgres.fullname" . }}
{{- end }}
{{- end }}

{{/*
Keycloak database password secret name — uses shared postgres secret when db.password is empty
*/}}
{{- define "platform.keycloak.db.password.secretName" -}}
{{- if .Values.keycloak.db.password }}
{{- include "platform.keycloak.secrets.fullname" . }}
{{- else }}
{{- include "platform.postgres.secrets.fullname" . }}
{{- end }}
{{- end }}

{{/*
Keycloak JDBC URL. When db.sslmode is set the connection is encrypted; a custom
CA (db.caCert) is trusted by pointing sslrootcert at the mounted CA file, which
the PostgreSQL JDBC driver reads.
*/}}
{{- define "platform.keycloak.db.url" -}}
{{- $url := printf "jdbc:postgresql://%s:%v/%s" (include "platform.keycloak.db.host" .) (int .Values.keycloak.db.port) .Values.keycloak.db.database -}}
{{- if .Values.keycloak.db.sslmode -}}
{{- $url = printf "%s?sslmode=%s" $url .Values.keycloak.db.sslmode -}}
{{- if .Values.keycloak.db.caCert -}}
{{- $url = printf "%s&sslrootcert=%s" $url "/etc/keycloak/pg-ca/ca.crt" -}}
{{- end -}}
{{- end -}}
{{- $url -}}
{{- end }}

{{/* ---- Platform resources ---- */}}

{{/*
Controller ServiceAccount name
*/}}
{{- define "platform.controller.serviceAccountName" -}}
{{- printf "%s-controller" (include "platform.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
API Server ServiceAccount name
*/}}
{{- define "platform.apiserver.serviceAccountName" -}}
{{- printf "%s-apiserver" (include "platform.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* Platform-owned OTel collector for the ClickStack telemetry backend. */}}
{{- define "platform.clickstack.collector.fullname" -}}
{{- printf "%s-clickstack-collector" (include "platform.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* HTTP endpoint of the ClickStack ClickHouse store — the api-server's
     owner-scoped telemetry read path queries it directly (docs/architecture/
     observability.md). The operator names the headless Service
     {clickstack.fullname}-clickhouse-clickhouse-headless, and the subchart's
     fullname derives from .Release.Name (NOT platform.fullname) — mirror that
     logic. Assumes clickstack.nameOverride/fullnameOverride stay unset. */}}
{{- define "platform.clickstack.clickhouse.httpUrl" -}}
{{- $fullname := ternary .Release.Name (printf "%s-clickstack" .Release.Name) (contains "clickstack" .Release.Name) | trunc 63 | trimSuffix "-" }}
{{- printf "http://%s-clickhouse-clickhouse-headless.%s.svc.cluster.local:8123" $fullname .Release.Namespace }}
{{- end }}

{{/* Call with (dict "root" $ "templateName" <name> "rail" $tmpl.telemetry).
     Each harness reads its own export env, so `telemetry` names the rail:
     `true` (or "claude-code") for the Claude Code env, "bob" for Bob Shell's.
     Both land on the same collector over the agent's ordinary gateway egress —
     see docs/architecture/observability.md. */}}
{{- define "platform.agentTelemetry.env" -}}
{{- if eq (toString .rail) "bob" }}
{{- include "platform.agentTelemetry.env.bob" . }}
{{- else }}
{{- include "platform.agentTelemetry.env.claudeCode" . }}
{{- end }}
{{- end }}

{{/* The harness's default OTel service name is the CLI's own ("claude-code" for
     every claude-code-based image), which makes derived templates like nous
     indistinguishable in the exploration UI — so name the service after the
     template. */}}
{{- define "platform.agentTelemetry.env.claudeCode" -}}
{{- $host := printf "%s.%s.svc.cluster.local" (include "platform.clickstack.collector.fullname" .root) .root.Release.Namespace }}
- name: OTEL_SERVICE_NAME
  value: {{ .templateName | quote }}
- name: CLAUDE_CODE_ENABLE_TELEMETRY
  value: "1"
- name: CLAUDE_CODE_ENHANCED_TELEMETRY_BETA
  value: "1"
# Keep traceparent propagation on when the harness fronts a custom upstream
# (non-Anthropic ANTHROPIC_BASE_URL disables it by default); the gateway strips
# traceparent/tracestate before any external upstream, so nothing leaks outward.
- name: CLAUDE_CODE_PROPAGATE_TRACEPARENT
  value: "1"
- name: OTEL_METRICS_EXPORTER
  value: "otlp"
- name: OTEL_LOGS_EXPORTER
  value: "otlp"
- name: OTEL_TRACES_EXPORTER
  value: "otlp"
- name: OTEL_EXPORTER_OTLP_PROTOCOL
  value: "http/protobuf"
- name: OTEL_EXPORTER_OTLP_ENDPOINT
  value: {{ printf "https://%s:4318" $host | quote }}
- name: OTEL_METRIC_EXPORT_INTERVAL
  value: "1000"
- name: OTEL_LOGS_EXPORT_INTERVAL
  value: "1000"
- name: OTEL_TRACES_EXPORT_INTERVAL
  value: "1000"
{{- end }}

{{/* Bob Shell reads none of the standard OTEL_* env for its own telemetry — it
     builds a tracer from BOB_TELEMETRY_* alone and posts OTLP/HTTP JSON to
     {URL}{SERVICE_PATH}. Only traces exist; there are no per-call log records.
     Three of these are load-bearing rather than cosmetic:
       - the LF key pair is validated even though the collector ignores it, and
         a failed parse silently falls back to Bob's own IBM endpoint;
       - AGENT_OPS gates the LLM Generation span, which carries every counter;
       - the service name is hardcoded to "bob-shell" (OTEL_SERVICE_NAME is not
         read), so templates off this image share one name in the UI. */}}
{{- define "platform.agentTelemetry.env.bob" -}}
{{- $host := printf "%s.%s.svc.cluster.local" (include "platform.clickstack.collector.fullname" .root) .root.Release.Namespace }}
- name: BOB_TELEMETRY_PROVIDER
  value: "langfuse"
- name: BOB_TELEMETRY_URL
  value: {{ printf "https://%s:4318" $host | quote }}
- name: BOB_TELEMETRY_SERVICE_PATH
  value: "/v1/traces"
- name: BOB_TELEMETRY_AGENT_OPS_ENABLED
  value: "true"
- name: BOB_TELEMETRY_LF_PUBLIC_KEY
  value: "unused"
- name: BOB_TELEMETRY_LF_SECRET_KEY
  value: "unused"
{{- end }}
