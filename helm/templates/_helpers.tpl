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

{{- /* An Environment endpoint's address, with {host} for its
       `<endpoint>-<environment>` label; empty without environments.domain.
       `urls.environments` overrides, like the other `urls.*`. */ -}}
{{- define "platform.url.environments" -}}
{{- with .Values.environments.domain }}
{{- if $.Values.urls.environments }}
{{- $.Values.urls.environments }}
{{- else if $.Values.port }}
{{- printf "%s://{host}.%s:%v" $.Values.scheme . $.Values.port }}
{{- else }}
{{- printf "%s://{host}.%s" $.Values.scheme . }}
{{- end }}
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

{{- /* The public URL of one host of this deployment: an explicit
       `urls.<key>` wins, else `{scheme}://{sub.}{hostport}`. No `sub` means
       the app host, whose override key is `ui`, with `urls.api` as a
       back-compat fallback. The override key is the subdomain, so a new public
       host costs one call, not one template.
       Pass `dict "root" $ "sub" "share"`. */ -}}
{{- define "platform.url.derived" -}}
{{- $key := ternary "ui" .sub (empty .sub) -}}
{{- $urls := .root.Values.urls -}}
{{- $url := index $urls $key -}}
{{- if and (empty $url) (eq $key "ui") -}}
{{- $url = $urls.api -}}
{{- end -}}
{{- if $url -}}
{{- $url -}}
{{- else -}}
{{- $hostport := include "platform.hostport" .root -}}
{{- $host := ternary (printf "%s.%s" .sub $hostport) $hostport (not (empty .sub)) -}}
{{- printf "%s://%s" .root.Values.scheme $host -}}
{{- end -}}
{{- end }}

{{- /* Single app URL (path-based ingress): UI and API share a host. */ -}}
{{- define "platform.url.ui" -}}
{{- include "platform.url.derived" (dict "root" .) -}}
{{- end }}

{{- define "platform.url.keycloak" -}}
{{- include "platform.url.derived" (dict "root" . "sub" "keycloak") -}}
{{- end }}

{{- /* Public share host serving artifact-library content. A dedicated origin
       by design: user-generated content must never share the app origin's
       cookies/tokens. Routed to the api-server (host-gated there). */ -}}
{{- define "platform.url.share" -}}
{{- include "platform.url.derived" (dict "root" . "sub" "share") -}}
{{- end }}

{{- /* Content host framed by the share host: artifact documents and raw
       bytes only, no cookie, no sign-in, no app route. A separate origin so
       the browser keeps artifact code away from the share host. Routed to
       the api-server (host-gated there). */ -}}
{{- define "platform.url.content" -}}
{{- include "platform.url.derived" (dict "root" . "sub" "content") -}}
{{- end }}

{{- /* A backchannel address: `{scheme}://{sub.}{domain}{:port}` from
       `backchannel.*`, no `sub` for the app host. Empty with the backchannel
       off. Pass `dict "root" $ "sub" "share"`. */ -}}
{{- define "platform.backchannel.url" -}}
{{- $b := .root.Values.backchannel -}}
{{- if $b.enabled -}}
{{- $host := ternary (printf "%s.%s" .sub $b.domain) $b.domain (not (empty .sub)) -}}
{{- if $b.port -}}
{{- printf "%s://%s:%v" $b.scheme $host $b.port -}}
{{- else -}}
{{- printf "%s://%s" $b.scheme $host -}}
{{- end -}}
{{- end -}}
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
Shared Redis password Secret name
*/}}
{{- define "platform.redis.authSecretName" -}}
{{- printf "%s-auth" (include "platform.redis.fullname" .) }}
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
API Server app name (Deployment + public Service)
*/}}
{{- define "platform.apiserver.fullname" -}}
{{- printf "%s-apiserver" (include "platform.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
In-cluster URL of the waypoint-fronted harness Service, which the api-server
and the controller both hand to agents.
*/}}
{{- define "platform.apiserver.harnessUrl" -}}
{{- printf "http://%s-apiserver-harness.%s.svc.cluster.local:%v" (include "platform.fullname" .) .Release.Namespace .Values.apiServer.harnessServerPort }}
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
API Server secrets name — chart-managed Secret holding operator-supplied credentials
*/}}
{{- define "platform.apiserver.secrets.fullname" -}}
{{- printf "%s-apiserver-secrets" (include "platform.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
API Server database password secret name — uses shared postgres secret when db.password is empty
*/}}
{{/*
The ConfigMap the switch leaves behind, and the one ConfigMap both components
read at startup. The chart names it because the api-server's Role pins it by
name; the truncation matches what any Kubernetes object name allows, so a long
release name cannot render a marker nothing can create.
*/}}
{{- define "platform.agentStore.markerName" -}}
{{- printf "%s-agent-store" (include "platform.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end }}

{{/*
The controller's connection string: the api-server's database and TLS — one
platform database per install — under the controller's own login. The password
arrives through the pod's POSTGRES_PASSWORD, so the string carries a reference
rather than a credential.
*/}}
{{- define "platform.controller.postgres.dsn" -}}
{{- $dsn := printf "postgresql://%s:$(POSTGRES_PASSWORD)@%s:%v/%s" .Values.controller.db.user (include "platform.apiserver.db.host" .) (int .Values.apiServer.db.port) .Values.apiServer.db.database -}}
{{- /* The CA reaches the driver the way libpq reads it: sslrootcert in the
       string. An install that sets one but no sslmode gets verify-full, since a
       CA nobody verifies is decoration; require plus a root certificate then
       verifies the chain as verify-ca, which is libpq's own rule. */ -}}
{{- $sslmode := .Values.apiServer.db.sslmode -}}
{{- if and .Values.apiServer.db.caCert (not $sslmode) -}}
{{- $sslmode = "verify-full" -}}
{{- end -}}
{{- $params := list -}}
{{- if $sslmode -}}
{{- $params = append $params (printf "sslmode=%s" $sslmode) -}}
{{- end -}}
{{- if .Values.apiServer.db.caCert -}}
{{- $params = append $params "sslrootcert=/etc/platform/pg-ca/ca.crt" -}}
{{- end -}}
{{- if $params -}}
{{- $dsn = printf "%s?%s" $dsn (join "&" $params) -}}
{{- end -}}
{{- $dsn -}}
{{- end }}

{{/*
Where the controller's password comes from: the api-server's credentials Secret
when an operator supplies one (an external database, usually through ESO), and
the bundled database's Secret otherwise.
*/}}
{{- define "platform.controller.db.password.secretName" -}}
{{- if .Values.controller.db.password }}
{{- include "platform.apiserver.secrets.fullname" . }}
{{- else }}
{{- include "platform.postgres.secrets.fullname" . }}
{{- end }}
{{- end }}

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
{{- include "platform.apiserver.fullname" . }}
{{- end }}

{{- /* The browser tab title, written into the UI shell by nginx so a client
       that runs no JavaScript still reads it. HTML-escaped, and with nginx's
       `$` and `\` spelled as entities, for the single-quoted sub_filter. */ -}}
{{- define "platform.ui.shellTitle" -}}
{{- .Values.brand.title | default .Values.brand.name | html | replace "$" "&#36;" | replace "\\" "&#92;" }}
{{- end }}

{{/*
UI app name (Deployment + Service)
*/}}
{{- define "platform.ui.fullname" -}}
{{- printf "%s-ui" (include "platform.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
VM runner ServiceAccount name. The controller stamps it on every runner it
creates, so it has to match the ServiceAccount vm-runner.yaml renders.
*/}}
{{- define "platform.vmRunner.serviceAccountName" -}}
{{- printf "%s-vm-runner" (include "platform.fullname" .) }}
{{- end }}

{{/*
The PriorityClass this release renders for its own runner pods. Always rendered,
whether or not the install names a class of its own: helm deletes what it stops
rendering, and a runner Deployment keeps the class it was rolled with, so a
switch to a named class would otherwise leave live templates pointing at a class
that no longer exists, and their next pod refused at admission.
*/}}
{{- define "platform.vmRunner.ownPriorityClassName" -}}
{{- printf "%s-vm-runner-priority-%d" (include "platform.fullname" .) (int .Values.virtualization.runner.priority) }}
{{- end }}

{{/*
The PriorityClass every runner pod runs under: the one the install names, else
this release's own, which the chart renders beside the runners. Cluster-scoped
and named after the release, because several installs share a cluster's nodes.
*/}}
{{- define "platform.vmRunner.priorityClassName" -}}
{{- .Values.virtualization.runner.priorityClassName | default (include "platform.vmRunner.ownPriorityClassName" .) }}
{{- end }}

{{/* The VM runner image: by digest when one is pinned, else by tag. */}}
{{- define "platform.vmRunner.image" -}}
{{- $i := .Values.virtualization.runner.image }}
{{- if $i.digest }}{{ printf "%s@%s" $i.repository $i.digest }}{{ else }}{{ printf "%s:%s" $i.repository ($i.tag | default .Chart.AppVersion) }}{{ end }}
{{- end }}
{{/*
The node directory this install stages runner releases in: its own
subdirectory of `runner.releaseHostPath`, named after the agent namespace,
because every stager keeps only the newest few releases in its directory and
installs that share nodes would otherwise remove each other's.
*/}}
{{- define "platform.vmRunner.releaseDir" -}}
{{- with .Values.virtualization.runner.releaseHostPath }}{{ printf "%s/%s" (trimSuffix "/" .) $.Values.agentNamespace }}{{ end }}
{{- end }}
{{/*
The node directory this install caches images in: its own subdirectory of
`imageCache.hostPath`, one segment each for the release namespace and the
release name — the pair the cluster already keeps unique. Two segments, not a
dash join: joined, namespace `a-b` with release `c` and namespace `a` with
release `b-c` both name `a-b-c`. The service is the only writer of the
directory it serves, so two installs on a shared node given one directory take
turns unlinking each other's socket and serving each other's trees. Deriving
it from the install's own name means no value can hand two installs one
directory.
*/}}
{{- define "platform.vmImageCache.dir" -}}
{{- with .Values.virtualization.imageCache | default dict }}{{ with .hostPath }}{{ printf "%s/%s/%s" (clean .) $.Release.Namespace $.Release.Name }}{{ end }}{{ end }}
{{- end }}
{{/*
What unpacking an image faithfully costs, and nothing else: every capability
the runtime would grant is dropped first. A rootfs carries the owners and modes
its files were built with, so tar chowns each entry (CHOWN), sets a mode on a
file it has just given away (FOWNER), keeps a setgid bit on a file whose group
is not its own (FSETID), and keeps writing into directories that are read-only
or no longer its own (DAC_OVERRIDE). There is no MKNOD: the unpack skips the
image's /dev, and fails on a device node anywhere else. The runners this
service serves only read, so they hold none of CHOWN, FOWNER and FSETID.
On OpenShift the service runs as spc_t: the label the cache sets is set from
inside the container, and container_t may not relabel a host directory any
more than write it. spc_t is the type a privileged container gets, unconfined
by SELinux, without this becoming a privileged container. `runner.scc` has to
leave the type to the pod (seLinuxContext RunAsAny); under MustRunAs admission
refuses this pod. The runners keep container_t.
*/}}
{{- define "platform.vmImageCache.securityContext" -}}
runAsUser: 0
capabilities:
  drop: ["ALL"]
  add: ["CHOWN", "FOWNER", "FSETID", "DAC_OVERRIDE"]
appArmorProfile:
  type: Unconfined
{{- if .Values.openshift.enabled }}
seLinuxOptions:
  type: spc_t
  level: s0
{{- end }}
{{- end }}

{{/* Platform-owned OTel collector for the ClickStack telemetry backend. */}}
{{- define "platform.clickstack.collector.fullname" -}}
{{- printf "%s-clickstack-collector" (include "platform.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* In-cluster host of the collector Service, without scheme or port. */}}
{{- define "platform.clickstack.collector.host" -}}
{{- printf "%s.%s.svc.cluster.local" (include "platform.clickstack.collector.fullname" .) .Release.Namespace }}
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

{{/* The harness catalog the api-server serves, as JSON: the default harness
     and each enabled harness with its display fields, the provider types it
     runs on and, with clickstack enabled, its export rail's env. The rail
     names the OTel service after the harness, so a session's telemetry reads
     as the harness it ran on. */}}
{{- define "platform.harnesses" -}}
{{- $catalog := dict }}
{{- range $name, $h := .Values.harnesses.catalog }}
{{- if and $h $h.enabled }}
{{- $entry := omit $h "enabled" "telemetry" }}
{{- if and $.Values.clickstack.enabled $h.telemetry }}
{{- $_ := set $entry "telemetryEnv" (include "platform.agentTelemetry.env" (dict "root" $ "templateName" $name "rail" $h.telemetry) | fromYamlArray) }}
{{- end }}
{{- $_ := set $catalog $name $entry }}
{{- end }}
{{- end }}
{{- if not (hasKey $catalog .Values.harnesses.default) }}
{{- fail (printf "harnesses.default: %q is not an enabled entry of harnesses.catalog" .Values.harnesses.default) }}
{{- end }}
{{- dict "default" .Values.harnesses.default "catalog" $catalog | toJson }}
{{- end }}

{{/* Call with (dict "root" $ "templateName" <name> "rail" <telemetry>), where
     <name> is a harnessTemplates entry or a harnesses.catalog entry.
     Each harness reads its own export env, so `telemetry` names the rail:
     `true` (or "claude-code") for the Claude Code env, "bob" for Bob Shell's,
     "pi" for the image's Pi exporter, "codex" for the flags the Codex image
     renders. All land on the same collector over the agent's ordinary gateway
     egress — see docs/architecture/observability.md. */}}
{{- define "platform.agentTelemetry.env" -}}
{{- $rail := toString .rail }}
{{- if or (eq $rail "true") (eq $rail "claude-code") }}
{{- include "platform.agentTelemetry.env.claudeCode" . }}
{{- else if eq $rail "bob" }}
{{- include "platform.agentTelemetry.env.bob" . }}
{{- else if eq $rail "pi" }}
{{- include "platform.agentTelemetry.env.pi" . }}
{{- else if eq $rail "codex" }}
{{- include "platform.agentTelemetry.env.codex" . }}
{{- else }}
{{- fail (printf "%s.telemetry: %q is not a known export rail — use true/claude-code, bob, pi or codex. An unknown name would silently render the wrong rail and the agent's spend would never reach Usage." .templateName $rail) }}
{{- end }}
{{- end }}

{{/* The harness's default OTel service name is the CLI's own ("claude-code" for
     every claude-code-based image), which makes derived templates like nous
     indistinguishable in the exploration UI — so name the service after the
     template or catalog harness. */}}
{{- define "platform.agentTelemetry.env.claudeCode" -}}
{{- $host := include "platform.clickstack.collector.host" .root }}
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
# The image's model-gateway.sh then points the OTLP endpoint at the agent's
# gateway, which forwards to the collector, so the export skips Claude Code's
# one proxied socket. The controller serves that path whenever this chart sets
# its collector host, which is when this rail renders.
- name: PLATFORM_TELEMETRY_VIA_GATEWAY
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

{{/* Pi exports nothing itself: the image's pi-platform-telemetry extension
     posts one OTLP/HTTP JSON log record per model call (pi.api_request) to
     {ENDPOINT}/v1/logs, and only while OTEL_LOGS_EXPORTER is "otlp". */}}
{{- define "platform.agentTelemetry.env.pi" -}}
{{- $host := include "platform.clickstack.collector.host" .root }}
- name: OTEL_SERVICE_NAME
  value: {{ .templateName | quote }}
- name: OTEL_LOGS_EXPORTER
  value: "otlp"
- name: OTEL_EXPORTER_OTLP_ENDPOINT
  value: {{ printf "https://%s:4318" $host | quote }}
{{- end }}

{{/* Codex reads its OTLP exporters only from the [otel] table of its
     config.toml, never from this env: the image's launch scripts turn it into
     `-c otel.*` flags, logs to {ENDPOINT}/v1/logs while OTEL_LOGS_EXPORTER is
     "otlp" and traces to {ENDPOINT}/v1/traces while OTEL_TRACES_EXPORTER is.
     Codex fixes its own service name, so OTEL_SERVICE_NAME would be inert. */}}
{{- define "platform.agentTelemetry.env.codex" -}}
{{- $host := include "platform.clickstack.collector.host" .root }}
- name: OTEL_LOGS_EXPORTER
  value: "otlp"
- name: OTEL_TRACES_EXPORTER
  value: "otlp"
- name: OTEL_EXPORTER_OTLP_ENDPOINT
  value: {{ printf "https://%s:4318" $host | quote }}
{{- end }}

{{/* Bob Shell builds its own tracer from BOB_TELEMETRY_* and posts OTLP/HTTP
     JSON to {URL}{SERVICE_PATH}. Only traces exist; there are no per-call log
     records. It also reads the standard OTEL_EXPORTER_OTLP_* env: when an
     endpoint is set it ignores BOB_TELEMETRY_PROVIDER and exports to that
     endpoint and to IBM's own at once, and a value it cannot parse drops the
     whole rail and sends the export to IBM only. So a Bob image belongs on this
     rail, never on the Claude Code one.
     Three of these are load-bearing rather than cosmetic:
       - the LF key pair is validated even though the collector ignores it, and
         a failed parse silently falls back to Bob's own IBM endpoint;
       - AGENT_OPS gates the LLM Generation span, which carries every counter;
       - the service name is hardcoded to "bob-shell" (OTEL_SERVICE_NAME is read
         only on the standard OTLP env), so templates off this image share one name in the UI. */}}
{{- define "platform.agentTelemetry.env.bob" -}}
{{- $host := include "platform.clickstack.collector.host" .root }}
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

{{/*
OpenShift grants `use` on a built-in SCC through an auto-generated ClusterRole
named system:openshift:scc:<scc>. The VM runner identity and the KVM device
plugin both bind one the same way.
Args: dict "root" $ "name" <ServiceAccount> "component" <label> "scc" <scc>,
and optionally "namespace" when the identity does not live in the release
namespace (the VM runner's sits beside the runners it owns).
*/}}
{{- define "platform.sccRoleBinding" -}}
{{- $ns := .namespace | default .root.Release.Namespace -}}
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: {{ .name }}-scc
  namespace: {{ $ns }}
  labels:
    {{- include "platform.labels" .root | nindent 4 }}
    app.kubernetes.io/component: {{ .component }}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: system:openshift:scc:{{ .scc }}
subjects:
  - kind: ServiceAccount
    name: {{ .name }}
    namespace: {{ $ns }}
{{- end }}

{{/*
Whether a built-in starter kit is enabled: `starterKits.builtin.kits.<id>.enabled`,
defaulting to true when the kit has no entry. Usage:
  {{ include "platform.starterKits.kitEnabled" (dict "root" $ "id" $id) }} -> "true" | ""
*/}}
{{- define "platform.starterKits.kitEnabled" -}}
{{- $cfg := index (.root.Values.starterKits.builtin.kits | default dict) .id -}}
{{- if or (not $cfg) (ne $cfg.enabled false) -}}true{{- end -}}
{{- end -}}

{{/*
Name of the chart-managed pull Secret for a harness template that declares
`imagePullSecret`. harness-templates.yaml references it and
harness-template-pull-secrets.yaml renders it, so both take it from here.
Usage: {{ include "platform.harnessTemplate.pullSecretName" (dict "root" $ "name" $name) }}
*/}}
{{- define "platform.harnessTemplate.pullSecretName" -}}
{{- printf "%s-tmpl-%s-pull" (include "platform.fullname" .root) .name }}
{{- end -}}
