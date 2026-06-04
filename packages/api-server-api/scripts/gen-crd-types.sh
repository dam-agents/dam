#!/usr/bin/env bash
# Generate the Agent + Fork CR spec TypeScript types from the controller's CRDs
# (ADR-058). Shared by api-server-api:gen:crd-types (writes the committed file)
# and api-server-api:check:gen (writes a temp file, then diffs) so the drift
# gate never rewrites the committed file that tsc consumers read.
#
# Usage: gen-crd-types.sh <repo-root> <output-file>
set -eo pipefail
root="$1"
out="$2"
crds="$root/deploy/helm/platform/files/crds"

emit() { # <crd-file> <TypeName> — the CRD's .spec subschema as a TS interface
  yq -o=json ".spec.versions[0].schema.openAPIV3Schema.properties.spec | .title = \"$2\"" "$crds/$1" \
    | json2ts --no-additionalProperties --bannerComment ""
}

{
  echo "/* Code generated from the agent-platform.ai CRDs by \`mise run api-server-api:gen:crd-types\`. DO NOT EDIT. */"
  echo
  emit agent-platform.ai_agents.yaml AgentSpecCR
  echo
  emit agent-platform.ai_forks.yaml ForkSpecCR
} >"$out"

pnpm exec prettier --write --config "$root/.prettierrc" "$out" >/dev/null
