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

{{/* ---- Shared Redis (ADR-036) ---- */}}

{{/*
Shared Redis fullname (StatefulSet + Service)
*/}}
{{- define "platform.redis.fullname" -}}
{{- printf "%s-redis" (include "platform.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Redis URL exposed to consumers (no auth in v1; matches Postgres).
*/}}
{{- define "platform.redis.url" -}}
{{- printf "redis://%s:%d" (include "platform.redis.fullname" .) (int .Values.redis.port) }}
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
API Server database password secret name — uses shared postgres secret when db.password is empty
*/}}
{{- define "platform.apiserver.db.password.secretName" -}}
{{- if .Values.apiServer.db.password }}
{{- printf "%s-apiserver-secrets" (include "platform.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- include "platform.postgres.secrets.fullname" . }}
{{- end }}
{{- end }}

{{/*
API Server PostgreSQL DSN
*/}}
{{- define "platform.apiserver.postgres.dsn" -}}
{{- printf "postgresql://%s:$(POSTGRES_PASSWORD)@%s:%v/%s" .Values.apiServer.db.user (include "platform.apiserver.db.host" .) (int .Values.apiServer.db.port) .Values.apiServer.db.database }}
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
Keycloak JDBC URL
*/}}
{{- define "platform.keycloak.db.url" -}}
{{- printf "jdbc:postgresql://%s:%v/%s" (include "platform.keycloak.db.host" .) (int .Values.keycloak.db.port) .Values.keycloak.db.database }}
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
