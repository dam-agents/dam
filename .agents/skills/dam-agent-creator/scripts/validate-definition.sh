#!/usr/bin/env bash
# validate-definition.sh — read-only structural validation of a generated agent
# definition repository (dam-agent-creator, Phase 5).
#
# Usage: validate-definition.sh <path-to-generated-repo>
# Prints PASS/WARN/FAIL lines; exit 0 = no FAILs, exit 1 = at least one FAIL.
# Deliberately awk-free and BSD/GNU-portable (runs on dev macOS and the Linux pod).

set -u
export LC_ALL=C

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
  --include='*.md' --include='*.sh' --exclude='validate-definition.sh' . 2>/dev/null \
  | grep -v '^\./\.git/' || true)"
if [ -n "$leftovers" ]; then
  fail "unresolved placeholders / TODO(creator) markers remain:"
  printf '%s\n' "$leftovers" | sed 's/^/      /'
else
  pass "no unresolved placeholders or TODO(creator) markers"
fi

grep -rqi 'code-guardian' --include='*.md' --include='*.sh' . 2>/dev/null \
  && warn "definition mentions 'code-guardian' — copied text? (fine only as an explicit credit)" \
  || pass "no stray reference-implementation mentions"

# ------------------------------------------------------------- shell scripts ----
if [ -d scripts ]; then
  for s in scripts/*.sh scripts/lib/*.sh scripts/tests/*.sh scripts/harness/*/*.sh; do
    [ -e "$s" ] || continue
    if bash -n "$s" 2>/dev/null; then pass "bash -n: $s"; else fail "syntax error: $s (bash -n)"; fi
    # this validator carries the literal 'awk' in its own detection pattern and message —
    # skip the awk check on a copy of itself so it never self-flags
    case "$(basename "$s")" in
      validate-definition.sh) pass "$s awk check skipped (validator itself)"; continue ;;
    esac
    # comment-only lines don't count ("deliberately awk-free" headers), and an
    # invocation always has whitespace/EOL after the word — "awk/diff" in a
    # message string is not a call
    grep -vE '^[[:space:]]*#' "$s" | grep -qE '(^|[^a-zA-Z0-9_])awk([[:space:]]|$)' \
      && fail "$s uses awk — not available on the pod" \
      || pass "$s is awk-free"
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
