# Codex reads the home's AGENTS.md only when $HOME is the git root of the work
# dir, so it reaches every session as the global instructions file, which Codex
# reads again each turn. An owner's own ~/.codex/AGENTS.md is left as it is.
codex_home="${CODEX_HOME:-$HOME/.codex}"
if [ -e "$HOME/AGENTS.md" ] && [ ! -e "$codex_home/AGENTS.md" ] && [ ! -L "$codex_home/AGENTS.md" ]; then
  mkdir -p "$codex_home" && ln -s "$HOME/AGENTS.md" "$codex_home/AGENTS.md"
fi
