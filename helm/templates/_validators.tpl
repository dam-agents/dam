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
{{- include "platform.validate.vmImageCachePathIsItsOwn" . -}}
{{- include "platform.validate.vmImageCacheLegacyPath" . -}}
{{- include "platform.validate.vmImageCacheEgress" . -}}
{{- include "platform.validate.vmValuesTheControllerCanUse" . -}}
{{- include "platform.validate.vmRunnerPodsNeedAReleaseDirectory" . -}}
{{- include "platform.validate.vmValuesThisChartNoLongerReads" . -}}
{{- include "platform.validate.egressLockdownModeExclusive" . -}}
{{- include "platform.validate.termsRequired" . -}}
{{- include "platform.validate.signUps" . -}}
{{- include "platform.validate.enterpriseGitHubNeedsBothHostAndToken" . -}}
{{- include "platform.validate.unenforcedMeshOnlyOnALocalCluster" . -}}
{{- include "platform.validate.controllerGatewayEgress" . -}}
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
controller.gatewayEgress opens private ranges and the cluster DNS pods to every
agent gateway, and the node image cache renders the same DNS rule and the same
peers shape into its own policy. The controller renders them into each
gateway's NetworkPolicy, which Kubernetes rejects outright when an entry is not
a CIDR or a selector is not one it can use — and a rejected policy fails every
agent's reconcile. A /0 entry would reopen every private range the policy
exists to close.
*/}}
{{- define "platform.validate.controllerGatewayEgress" -}}
{{- $egress := .Values.controller.gatewayEgress | default dict -}}
{{- range ($egress.extraCidrs | default list) -}}
{{- $entry := toString . -}}
{{- include "platform.validate.cidr" (dict "name" "controller.gatewayEgress.extraCidrs" "value" $entry) -}}
{{- if eq (int (last (splitList "/" $entry))) 0 -}}
{{- fail (printf "controller.gatewayEgress.extraCidrs entry %q opens every private range to agent gateways, which is what their egress policy closes. Name the enterprise service's own range instead." $entry) -}}
{{- end -}}
{{- end -}}
{{- $dns := $egress.clusterDns | default dict -}}
{{- if $dns -}}
{{- include "platform.validate.selector" (dict "name" "controller.gatewayEgress.clusterDns" "namespace" $dns.namespace "labels" ($dns.podLabels | default dict)) -}}
{{- range ($dns.ports | default list) -}}
{{- include "platform.validate.port" (dict "name" "controller.gatewayEgress.clusterDns" "value" .) -}}
{{- end -}}
{{- end -}}
{{- range ($egress.peers | default list) -}}
{{- $namespace := .namespace -}}
{{- include "platform.validate.selector" (dict "name" "controller.gatewayEgress.peers" "namespace" $namespace "labels" (.podLabels | default dict)) -}}
{{- range (.ports | default list) -}}
{{- include "platform.validate.port" (dict "name" (printf "controller.gatewayEgress.peers (namespace %q)" (toString $namespace)) "value" .) -}}
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
{{- fail "virtualization.enabled=true requires virtualization.imageCache.hostPath — the node directory tree the image cache service unpacks every image into, and the only place a runner gets an image from. Set it to a root on the runner nodes, such as /var/lib/platform-images; the chart appends this install's own subdirectory (imageCache.hostPath/<release namespace>/<release name>), which on OpenShift sits under the directory etc/openshift-node-config creates." -}}
{{- end -}}
{{- end -}}

{{/*
Nodes are shared, and a node directory is either the install's own or it is a
collision: the image cache service is the only writer of the directory it
serves, so an install given another's unlinks its socket and serves its trees,
and the release stager prunes every entry in the directory it stages into. The
chart derives the directory from the install's name, so two installs cannot be
given one; what is left to check is that the value is a path on the node and
that the derived directory stays out of the release directory's tree. Both
comparisons run on `clean`ed paths: `a//b`, `a/./b` and `a/x/../b` name the
same directory as `a/b`.
*/}}
{{- define "platform.validate.vmImageCachePathIsItsOwn" -}}
{{- $v := .Values.virtualization -}}
{{- $root := (($v.imageCache | default dict).hostPath | default "") | toString -}}
{{- if and $v.enabled (not $v.runner.hostAddress) $root -}}
{{- if not (hasPrefix "/" $root) -}}
{{- fail (printf "virtualization.imageCache.hostPath %q is not an absolute path: it is a directory on every runner node, so it starts at /." $root) -}}
{{- end -}}
{{- $dir := include "platform.vmImageCache.dir" . | clean -}}
{{- $release := include "platform.vmRunner.releaseDir" . -}}
{{- if $release -}}
{{- $release = printf "%s/" ($release | clean) -}}
{{- if or (hasPrefix $release (printf "%s/" $dir)) (hasPrefix (printf "%s/" $dir) $release) -}}
{{- fail (printf "virtualization.imageCache.hostPath %q puts this install's cache directory %q in the release directory %q: the release stager prunes every entry there that is not one of its own releases, which would delete the cached trees a machine is booting from. Give the cache a root outside it." $root $dir ($release | trimSuffix "/")) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
An upgrade that moves the cache directory reaches every runner that rolls,
and the rollout waits out a busy owner's turn — `runner.rollout.idleWait`, a
day by default — so for that long a runner still mounts the directory the
previous release gave it. That directory's socket is gone once the service
serves the new one, and a runner that dials it boots only the trees its own
machines already hold. `imageCache.legacyPath` is that old directory, kept
alive by a second cache service over it until the roll reaches every runner.
It has to be the whole host directory a previous release served, and share no
directory with this install's own: one service over a directory that holds the
other's trees evicts them as its own least recently written.
*/}}
{{- define "platform.validate.vmImageCacheLegacyPath" -}}
{{- $v := .Values.virtualization -}}
{{- $legacy := (($v.imageCache | default dict).legacyPath | default "") | toString -}}
{{- if and $v.enabled (not $v.runner.hostAddress) $legacy -}}
{{- if not (hasPrefix "/" $legacy) -}}
{{- fail (printf "virtualization.imageCache.legacyPath %q is not an absolute path: it is the host directory a previous release served on every runner node, so it starts at /." $legacy) -}}
{{- end -}}
{{- $dir := include "platform.vmImageCache.dir" . | clean -}}
{{- if $dir -}}
{{- $old := printf "%s/" ($legacy | clean) -}}
{{- $new := printf "%s/" $dir -}}
{{- if or (eq ($legacy | clean) $dir) (hasPrefix $new $old) (hasPrefix $old $new) -}}
{{- fail (printf "virtualization.imageCache.legacyPath %q shares a directory with the cache directory %q this install serves: the window runs a second service over the legacy directory, and one over a directory that holds the other's trees evicts them as its own least recently written. Name the old directory alone, outside %q." $legacy $dir $dir) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
An address/prefix, either family. Kubernetes rejects the whole NetworkPolicy
on an entry it cannot parse, and a rejected policy leaves the pod it names
ungated until the next apply lands, so an entry is judged here rather than by
the API server: four decimal octets and a prefix up to 32, or an RFC 4291
group form — hex fields, at most one `::`, an optional dotted IPv4 tail in the
last two, and no more fields than the shape holds, which the pattern this
replaces let through (`2001:::1/64`). The prefix is decimal with no leading
zero: `netip.ParsePrefix` refuses `10.0.0.0/08`, which `net.ParseCIDR` takes,
so a `controller.gatewayEgress` range written that way kept the controller from
starting, and a range a policy carries reaches consumers with parsers of their
own.
*/}}
{{- define "platform.validate.cidr" -}}
{{- $value := toString .value -}}
{{- $parts := splitList "/" $value -}}
{{- $octet := "(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])" -}}
{{- $v4 := printf "^%s(\\.%s){3}$" $octet $octet -}}
{{- $valid := false -}}
{{- if eq (len $parts) 2 -}}
{{- $addr := index $parts 0 -}}
{{- $prefix := index $parts 1 -}}
{{- if regexMatch $v4 $addr -}}
{{- $valid = and (regexMatch "^(0|[1-9][0-9]?)$" $prefix) (le (int $prefix) 32) -}}
{{- else if contains ":" $addr -}}
{{- $head := $addr -}}
{{- $tail := last (splitList ":" $addr) -}}
{{- if contains "." $tail -}}
{{- $head = "" -}}
{{- if regexMatch $v4 $tail -}}{{- $head = printf "%s0:0" (trimSuffix $tail $addr) -}}{{- end -}}
{{- end -}}
{{- if and $head (regexMatch "^(0|[1-9][0-9]{0,2})$" $prefix) (le (int $prefix) 128) -}}
{{- $halves := splitList "::" $head -}}
{{- $left := index $halves 0 -}}
{{- $right := "" -}}
{{- if eq (len $halves) 2 -}}{{- $right = index $halves 1 -}}{{- end -}}
{{- $compressed := eq (len $halves) 2 -}}
{{- $fields := 0 -}}
{{- $bad := or (gt (len $halves) 2) (hasPrefix ":" $left) (hasSuffix ":" $left) (hasPrefix ":" $right) (hasSuffix ":" $right) -}}
{{- range $g := (splitList ":" (ternary (printf "%s:%s" $left $right) $left $compressed)) -}}
{{- if $g -}}
{{- if not (regexMatch "^[0-9a-fA-F]{1,4}$" $g) -}}{{- $bad = true -}}{{- end -}}
{{- $fields = add1 $fields -}}
{{- end -}}
{{- end -}}
{{- if not $bad -}}{{- $valid = ternary (le $fields 7) (eq $fields 8) $compressed -}}{{- end -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- if not $valid -}}
{{- fail (printf "%s entry %q is not an address/prefix — four decimal octets and a prefix up to 32, or hex groups and a prefix up to 128, the prefix written without a leading zero. Kubernetes rejects the whole NetworkPolicy on one entry its parser cannot read, which leaves the pod it names ungated until the next apply, and the controller will not start on a `controller.gatewayEgress` range its own parser refuses." .name $value) -}}
{{- end -}}
{{- end -}}

{{/*
A pod selector the API server takes. It rejects the whole NetworkPolicy on a
label outside the label grammar — a space in it, an empty name, an over-long
value — and a rejected policy leaves the pod it names ungated until the next
apply lands. The namespace is matched through `kubernetes.io/metadata.name`, so
its name is checked as the label value it is rendered as.
*/}}
{{- define "platform.validate.selector" -}}
{{- if not (kindIs "map" .labels) -}}
{{- fail (printf "%s podLabels must be a map of label keys to values, got the %s %v: a selector rendered from anything else matches no pod the policy admits, or is rejected whole." .name (kindOf .labels) .labels) -}}
{{- end -}}
{{- $namespace := toString .namespace -}}
{{- if not (and (regexMatch "^[a-z0-9]([-a-z0-9]*[a-z0-9])?$" $namespace) (le (len $namespace) 63)) -}}
{{- fail (printf "%s namespace %q is not a namespace name — lower-case alphanumerics and dashes, at most 63, beginning and ending with an alphanumeric. Kubernetes rejects the whole NetworkPolicy it is rendered into, which leaves the pod it names ungated until the next apply lands." .name $namespace) -}}
{{- end -}}
{{- $label := `^[A-Za-z0-9]([-A-Za-z0-9_.]*[A-Za-z0-9])?$` -}}
{{- $prefix := `^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$` -}}
{{- range $key, $value := (.labels | default dict) -}}
{{- if not (and (kindIs "string" $key) (kindIs "string" $value)) -}}
{{- fail (printf "%s label %v: %v has to be a string on both sides — a YAML number or boolean renders as one, and Kubernetes refuses the whole NetworkPolicy whose matchLabels holds it, which leaves the pod it names ungated until the next apply lands." $.name $key $value) -}}
{{- end -}}
{{- $parts := splitList "/" (toString $key) -}}
{{- $field := last $parts -}}
{{- $ok := and (le (len $parts) 2) (regexMatch $label $field) (le (len $field) 63) -}}
{{- if eq (len $parts) 2 -}}
{{- $ok = and $ok (regexMatch $prefix (index $parts 0)) (le (len (index $parts 0)) 253) -}}
{{- end -}}
{{- $text := toString $value -}}
{{- if or (not $ok) (and $text (not (and (regexMatch $label $text) (le (len $text) 63)))) -}}
{{- fail (printf "%s label %q: %q is not a label the API server takes — a key is a name of at most 63 alphanumerics, dashes, underscores and dots beginning and ending alphanumeric, optionally under a DNS prefix and a /; a value is the same or empty. Kubernetes rejects the whole NetworkPolicy on one it cannot use, which leaves the pod it names ungated until the next apply lands." $.name (toString $key) $text) -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
A port the API server takes, for the same reason: it rejects the whole policy
on `0`, and on anything past 65535, which a policy rendered as text does not
notice.
*/}}
{{- define "platform.validate.port" -}}
{{- $value := toString .value -}}
{{- if not (and (regexMatch "^[0-9]{1,5}$" $value) (ge (int $value) 1) (le (int $value) 65535)) -}}
{{- fail (printf "%s port %s is not a port number between 1 and 65535. Kubernetes rejects the whole NetworkPolicy on one it cannot parse, which leaves the pod it names ungated until the next apply lands." .name $value) -}}
{{- end -}}
{{- end -}}

{{/*
The image cache service's egress policy admits the public internet minus the
ranges the cluster owns, and the cluster DNS pods. A registry inside the
cluster is a peers entry, which Kubernetes rejects without a namespace or a
port and which an empty podLabels on makes every pod in the namespace; a
mirror outside it is a range, which has to be a real block, since a /0 would
reopen every range the policy exists to close.
*/}}
{{- define "platform.validate.vmImageCacheEgress" -}}
{{- if .Values.virtualization.enabled -}}
{{- $cache := .Values.virtualization.imageCache | default dict -}}
{{- $dns := (.Values.controller.gatewayEgress | default dict).clusterDns | default dict -}}
{{- if and (eq ($cache.dnsPolicy | default "ClusterFirst") "ClusterFirst") (not .Values.virtualization.runner.hostAddress) (not (and $dns.namespace $dns.podLabels)) -}}
{{- fail "virtualization.imageCache.dnsPolicy is ClusterFirst but controller.gatewayEgress.clusterDns names no namespace and podLabels, so the cache policy admits no DNS pod: every registry lookup fails, and a machine boots only the trees the cache already holds. Name the cluster DNS pods, or set imageCache.dnsPolicy=Default and admit the node's resolver in imageCache.egressCidrs." -}}
{{- end -}}
{{- range ($cache.egressCidrs | default list) -}}
{{- $entry := toString . -}}
{{- include "platform.validate.cidr" (dict "name" "virtualization.imageCache.egressCidrs" "value" $entry) -}}
{{- if eq (int (last (splitList "/" $entry))) 0 -}}
{{- fail (printf "virtualization.imageCache.egressCidrs entry %q opens every range to the node image cache service, which is what its egress policy closes — it already reaches the public internet. Name the mirror's own range instead." $entry) -}}
{{- end -}}
{{- end -}}
{{- range ($cache.peers | default list) -}}
{{- $namespace := .namespace -}}
{{- if or (not $namespace) (not .podLabels) (not .ports) -}}
{{- fail (printf "virtualization.imageCache.peers entry %v needs a namespace, the registry pod's podLabels and its ports. Kubernetes rejects a policy entry without a namespace or a port, and an entry with an empty podLabels admits every pod in that namespace." .) -}}
{{- end -}}
{{- include "platform.validate.selector" (dict "name" "virtualization.imageCache.peers" "namespace" $namespace "labels" (.podLabels | default dict)) -}}
{{- range .ports -}}
{{- include "platform.validate.port" (dict "name" (printf "virtualization.imageCache.peers (namespace %q)" $namespace) "value" .) -}}
{{- end -}}
{{- end -}}
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
{{- fail "virtualization.runner.releaseHostPath is required with virtualization.enabled: the release stager copies each runner release there, and every runner pod's loader takes a new runner image from it without rebooting a machine (unless that release declares another reboot key than the pod's release, which rolls the pods and reboots them; a pod whose release declares no key takes it in place). Set it to a node directory such as /var/lib/platform-vm-runner-releases; each install stages into its own subdirectory of it." -}}
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
{{- fail "virtualization.imageCache.preload is no longer read. The node image cache service is the only writer of the directory it serves, so it always runs where imageCache.hostPath is set, on the runners' own nodeSelector and tolerations; its interval is virtualization.imageCache.preloadInterval and its resources virtualization.imageCache.resources. Remove the preload block." -}}
{{- end -}}
{{- if hasKey $runner "ingressCidrs" -}}
{{- fail "virtualization.runner.ingressCidrs is no longer read. The runner's NetworkPolicy is the only gate on its published ports, admitting the api-server and the controller. Remove the key." -}}
{{- end -}}
{{- if hasKey $runner "releaseSameRuntimeOnly" -}}
{{- fail "virtualization.runner.releaseSameRuntimeOnly is no longer read: a runner release built against another VM runtime is handed off in place (unless it declares another reboot key than the pod's release, which rolls the pods instead; a pod whose release declares no key takes it in place), and a machine whose runtime errors, or whose guest goes quiet, is rebooted onto the runner's own runtime. To leave the new runtime, configure the previous runner image again. Remove the key." -}}
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
{{- fail "virtualization.runner.imageArchiveHostPath is no longer read. Staged image trees live in the node image cache directory the chart derives from virtualization.imageCache.hostPath, beside the trees its service fetches; `mise run image:stage-vm` stages there. Remove the key, or move its directory to imageCache.hostPath." -}}
{{- end -}}{{- if or (hasKey $runner "canaryImage") (hasKey $runner "canary") -}}
{{- fail "virtualization.runner.canaryImage and virtualization.runner.canary are no longer read: every runner runs virtualization.runner.image, rolled across owners by virtualization.runner.rollout. Remove the keys." -}}
{{- end -}}
{{- end -}}
