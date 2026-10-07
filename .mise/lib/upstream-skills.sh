# Sourced by skills:update and check:upstream-skills.
UPSTREAM_SKILLS_LOCK=.agents/upstream-skills.json

# Prints {"<path in skill dir>": "<git blob id>", …} for one skill directory.
skill_hashes() {
  (cd ".agents/skills/$1" && find . -type f | sed 's#^\./##' | LC_ALL=C sort |
    while IFS= read -r f; do printf '%s\t%s\n' "$f" "$(git hash-object -- "$f")"; done) |
    jq -R -n '[inputs | split("\t") | {(.[0]): .[1]}] | add // {}'
}
