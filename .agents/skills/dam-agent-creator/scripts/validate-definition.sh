#!/usr/bin/env bash
# validate-definition.sh — read-only structural validation of a generated agent
# definition repository (dam-agent-creator, Phase 5).
#
# Usage: validate-definition.sh [--reference <name>]... <path-to-generated-repo>
#   --reference  a definition this one may have been copied from; any mention of it
#                is flagged. Generation-time only: the skill names its references,
#                and a generated repo's own CI passes none.
# Prints PASS/WARN/FAIL lines; exit 0 = no FAILs, exit 1 = at least one FAIL.
# BSD/GNU-portable (runs on dev macOS and the Linux pod).

set -u
export LC_ALL=C

REFS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --reference) REFS="$REFS ${2:?--reference needs a name}"; shift 2 ;;
    *) break ;;
  esac
done
REPO="${1:-.}"
FAILS=0
WARNS=0

pass() { printf 'PASS  %s\n' "$1"; }
warn() { printf 'WARN  %s\n' "$1"; WARNS=$((WARNS + 1)); }
fail() { printf 'FAIL  %s\n' "$1"; FAILS=$((FAILS + 1)); }

[ -d "$REPO" ] || { echo "FAIL  no such directory: $REPO"; exit 1; }
cd "$REPO" || exit 1

# ---------------------------------------------------------- required files ----
for f in CLAUDE.md AGENTS.md ONBOARDING.md README.md VERSION CHANGELOG.md .gitignore \
         docs/self-modification.md docs/persistence.md scripts/verify-onboarding.sh; do
  if [ -f "$f" ]; then pass "required file: $f"; else fail "missing required file: $f"; fi
done

# ------------------------------------------------------- allowlist gitignore ----
if [ -f .gitignore ]; then
  first_rule="$(grep -v '^[[:space:]]*#' .gitignore | grep -v '^[[:space:]]*$' | head -1)"
  if [ "$first_rule" = "/*" ]; then
    pass ".gitignore is an allowlist (first rule is /*)"
  else
    fail ".gitignore must ignore everything first ('/*'); first rule is: ${first_rule:-<none>}"
  fi
  for inc in '!/.gitignore' '!/CLAUDE.md' '!/AGENTS.md' '!/ONBOARDING.md' '!/VERSION' '!/CHANGELOG.md' '!/docs/'; do
    grep -qxF "$inc" .gitignore \
      && pass ".gitignore re-includes ${inc#!/}" \
      || fail ".gitignore missing re-include: $inc"
  done
  grep -qxF '!/scripts/' .gitignore || { [ -d scripts ] \
      && fail ".gitignore missing re-include: !/scripts/ (scripts/ exists)" \
      || warn "no !/scripts/ re-include (fine only if the agent has no scripts)"; }
  grep -qxF '!/.github/' .gitignore || { [ -d .github ] \
      && fail ".gitignore missing re-include: !/.github/ (.github/ exists)" \
      || warn "no !/.github/ re-include (fine only if the definition has no CI)"; }
fi

# ------------------------------------------------------------------ kit.yaml ----
# The kit is read by the platform BEFORE the agent exists, so everything wrong with it
# fails silently: a kit that misses the schema is dropped from the catalog listing with
# only a server-side log, and a kit that declares `onboarding` stamps the agent onboarded
# at create — no gate, no checklist tools, no hold on its schedules. These are greps, not
# a YAML parse: they catch the shapes this skill's template can get wrong, not every way
# a hand-edited kit could be invalid. The platform's own schema is the real gate.
if [ ! -f kit.yaml ]; then
  warn "no kit.yaml — the agent must be created by hand (correct only for a private definition whose kit lives in the catalog repo)"
else
  pass "required file: kit.yaml"

  grep -qE '^schemaVersion:[[:space:]]*v1[[:space:]]*$' kit.yaml \
    && pass "kit.yaml declares schemaVersion v1" \
    || fail "kit.yaml must declare 'schemaVersion: v1' — the catalog drops a kit it cannot parse"

  if [ -f .gitignore ] && ! grep -qxF '!/kit.yaml' .gitignore; then
    fail ".gitignore missing re-include: !/kit.yaml (an untracked kit.yaml is invisible to the catalog)"
  elif [ -f .gitignore ]; then
    pass ".gitignore re-includes kit.yaml"
  fi

  if grep -qE '^onboarding:' kit.yaml; then
    fail "kit.yaml declares 'onboarding:' — leave it out, or the agent is stamped onboarded at create and loses the gate, the checklist tools and the hold on its schedules"
  else
    pass "kit.yaml leaves 'onboarding' absent (platform-composed briefing → ONBOARDING.md)"
  fi

  if grep -qE '^seed:' kit.yaml; then
    seed_block="$(sed -n '/^seed:/,/^[a-z]/p' kit.yaml)"
    printf '%s' "$seed_block" | grep -qE '^[[:space:]]+self:[[:space:]]*true' \
      && pass "kit.yaml seeds itself (seed.self)" \
      || fail "kit.yaml seed must be 'self: true' — a definition kit never repeats its own URL"
    printf '%s' "$seed_block" | grep -qE '^[[:space:]]+into:[[:space:]]*home' \
      && pass "kit.yaml seeds into \$HOME (seed.into: home)" \
      || fail "kit.yaml seed must be 'into: home' — this definition IS \$HOME, and the default ('work') would put it in the wrong place"
    printf '%s' "$seed_block" | grep -qE '^[[:space:]]+url:' \
      && fail "kit.yaml seed names both 'self' and 'url' — a seed names exactly one" \
      || pass "kit.yaml seed names exactly one source"
  else
    fail "kit.yaml declares no 'seed:' — without one the platform creates an agent with no definition"
  fi

  # id, the sentinel and the schedule prefix all name the same agent; a mismatch means
  # ONBOARDING creates a second copy of every schedule the kit already made.
  kit_id="$(grep -m1 -E '^id:' kit.yaml | sed -e 's/^id:[[:space:]]*//' -e 's/[[:space:]]*$//')"
  if [ -z "$kit_id" ]; then
    fail "kit.yaml declares no 'id:'"
  else
    pass "kit.yaml id: $kit_id"
    if [ -f ONBOARDING.md ]; then
      sentinel_name="$(grep -oE '\.[a-z0-9-]+-onboarded' ONBOARDING.md | head -1 | sed -e 's/^\.//' -e 's/-onboarded$//')"
      if [ -n "$sentinel_name" ] && [ "$sentinel_name" != "$kit_id" ]; then
        fail "kit.yaml id '$kit_id' != the agent name in ONBOARDING's sentinel '$sentinel_name'"
      elif [ -n "$sentinel_name" ]; then
        pass "kit id matches the onboarding sentinel"
      fi
    fi
    sched_block="$(sed -n '/^schedules:/,/^[a-z]/p' kit.yaml)"
    bad_names="$(printf '%s' "$sched_block" | grep -E '^[[:space:]]+-[[:space:]]*name:' \
      | grep -vE "^[[:space:]]+-[[:space:]]*name:[[:space:]]*$kit_id-" || true)"
    if [ -n "$bad_names" ]; then
      fail "schedule names must start with '$kit_id-' (the prefix ONBOARDING checks for):"
      printf '%s\n' "$bad_names" | sed 's/^/      /'
    elif [ -n "$sched_block" ]; then
      pass "every kit schedule name carries the agent prefix"
    fi
  fi

  # A precheck naming a script that is not in the repo is a broken check on every
  # occurrence — and it fails open, so the schedule keeps running and nobody notices.
  for s in $(grep -E '^[[:space:]]+precheck:' kit.yaml \
             | grep -oE 'scripts/[A-Za-z0-9_./-]+\.sh' | sort -u); do
    [ -f "$s" ] \
      && pass "kit precheck script exists: $s" \
      || fail "kit.yaml declares a precheck running $s, which this repo does not contain"
  done
fi

# ---------------------------------------------------- version & changelog ----
if [ -f VERSION ]; then
  ver="$(head -1 VERSION)"
  if printf '%s' "$ver" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
    pass "VERSION is semver: $ver"
  else
    fail "VERSION is not plain semver: '$ver'"
  fi
  if [ -f CHANGELOG.md ]; then
    latest="$(grep -m1 '^## ' CHANGELOG.md | cut -d' ' -f2)"
    if [ "$ver" = "$latest" ]; then
      pass "VERSION matches newest CHANGELOG heading ($latest)"
    else
      fail "VERSION ($ver) != newest CHANGELOG heading (${latest:-<none>})"
    fi
    grep -q '^\*\*Upgrade:\*\*' CHANGELOG.md \
      && pass "CHANGELOG entries carry Upgrade blocks" \
      || fail "CHANGELOG must carry an '**Upgrade:**' block per version (migration instructions, not a change log)"
  fi
fi

# ------------------------------------------------- CLAUDE.md mandatory parts ----
if [ -f CLAUDE.md ]; then
  for section in 'trust boundary' 'Hard invariants' 'Runtime configuration' 'Map of'; do
    grep -qi "$section" CLAUDE.md \
      && pass "CLAUDE.md has: $section" \
      || fail "CLAUDE.md missing mandatory section: $section"
  done
  lines="$(wc -l < CLAUDE.md | tr -d ' ')"
  [ "$lines" -le 170 ] \
    && pass "CLAUDE.md is slim ($lines lines)" \
    || warn "CLAUDE.md is $lines lines (>170) — move procedure text into docs/"
fi

# ----------------------------------------------- leftover scaffolding marks ----
# --exclude: a copy of this validator carries these literals in its own messages
leftovers="$(grep -rnE '\{\{[A-Z_]+\}\}|TODO\(creator\)' \
  --include='*.md' --include='*.sh' --include='*.yaml' --include='*.yml' \
  --exclude='validate-definition.sh' . 2>/dev/null \
  | grep -v '^\./\.git/' || true)"
if [ -n "$leftovers" ]; then
  fail "unresolved placeholders / TODO(creator) markers remain:"
  printf '%s\n' "$leftovers" | sed 's/^/      /'
else
  pass "no unresolved placeholders or TODO(creator) markers"
fi

for ref in $REFS; do
  grep -rqiF --include='*.md' --include='*.sh' --include='*.yaml' --include='*.yml' \
      -e "$ref" . 2>/dev/null \
    && warn "definition mentions reference implementation '$ref' — copied text? (fine only as an explicit credit)" \
    || pass "no mentions of reference implementation '$ref'"
done

# ------------------------------------------------------------- shell scripts ----
if [ -d scripts ]; then
  for s in scripts/*.sh scripts/lib/*.sh scripts/tests/*.sh scripts/harness/*/*.sh; do
    [ -e "$s" ] || continue
    if bash -n "$s" 2>/dev/null; then pass "bash -n: $s"; else fail "syntax error: $s (bash -n)"; fi
  done
fi

# ------------------------------------------------------ config reader parity ----
# The runtime and the verifier must read CONFIG.md identically. Two copies of a
# parser drift silently, so there is exactly one: scripts/lib/config.sh, sourced
# by both. This asserts the structure rather than diffing two function bodies —
# a text comparison has to guess where a shell function ends, and every wrong
# guess is either a gate that passes drifted readers or one that fails identical
# ones. The residual: this is structural, not semantic — a script that sources the
# lib and then parses CONFIG.md again under another name still passes.
for f in scripts/preflight.sh scripts/verify-onboarding.sh; do
  [ -f "$f" ] || continue
  if grep -q 'lib/config\.sh' "$f"; then
    pass "$f sources the shared config reader"
  else
    fail "$f does not source scripts/lib/config.sh — it must not parse CONFIG.md itself"
  fi
  if grep -qE '^[[:space:]]*cfg(_table)?\(\)' "$f"; then
    fail "$f defines its own cfg()/cfg_table() — the reader belongs in scripts/lib/config.sh alone"
  else
    pass "$f defines no config reader of its own"
  fi
done
if [ -f scripts/preflight.sh ] || [ -f scripts/verify-onboarding.sh ]; then
  [ -f scripts/lib/config.sh ] \
    && pass "shared config reader present (scripts/lib/config.sh)" \
    || fail "missing scripts/lib/config.sh — the single home of the CONFIG.md readers"
fi

# ------------------------------------------------------- dead relative links ----
dead=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  links="$(grep -oE '\]\([^)]+\)' "$f" 2>/dev/null | sed -e 's/^](//' -e 's/)$//')"
  [ -n "$links" ] || continue
  dir="$(dirname "$f")"
  while IFS= read -r l; do
    case "$l" in http://*|https://*|mailto:*|\#*) continue ;; esac
    # placeholder link targets in examples are not real paths
    case "$l" in "<"*|*"…"*|*'$'*|*"{"*|*" "*) continue ;; esac
    target="${l%%#*}"; [ -n "$target" ] || continue
    if [ ! -e "$dir/$target" ] && [ ! -e "$target" ]; then
      fail "dead link in $f: $l"
      dead=$((dead + 1))
    fi
  done <<EOF
$links
EOF
done < <(find . -name '*.md' -not -path './.git/*' -not -path './work/*' | sort)
[ "$dead" -eq 0 ] && pass "no dead relative links in any .md file"

# ----------------------------------------------------- sentinel consistency ----
if [ -f CLAUDE.md ] && [ -f ONBOARDING.md ]; then
  s_claude="$(grep -oE '\.[a-z0-9-]+-onboarded' CLAUDE.md | head -1)"
  s_onb="$(grep -oE '\.[a-z0-9-]+-onboarded' ONBOARDING.md | head -1)"
  if [ -n "$s_onb" ]; then
    if [ -z "$s_claude" ] || [ "$s_claude" = "$s_onb" ]; then
      pass "onboarding sentinel consistent ($s_onb)"
    else
      fail "sentinel mismatch: CLAUDE.md '$s_claude' vs ONBOARDING.md '$s_onb'"
    fi
  else
    fail "ONBOARDING.md defines no .<name>-onboarded sentinel guard"
  fi
fi

# -------------------------------------------------------------------- summary ----
echo
echo "validate-definition: $FAILS fail, $WARNS warn"
[ "$FAILS" -eq 0 ] || exit 1
exit 0
