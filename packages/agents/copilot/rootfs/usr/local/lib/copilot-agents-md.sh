# Copilot walks up from the work dir for AGENTS.md but stops at a git root, so
# it misses the home's AGENTS.md when the work dir is a repository of its own.
# Only then is that file linked in as a user instructions file, since a file
# Copilot reaches both ways loads twice. The link may dangle until the file is
# written; Copilot skips it. An owner's own file there is kept.
copilot_rule="${COPILOT_HOME:-$HOME/.copilot}/instructions/agent.instructions.md"
copilot_root="$(git rev-parse --show-toplevel 2>/dev/null)"
case "$(cd "$HOME" && pwd -P)/" in "$copilot_root"/*) copilot_root= ;; esac
if [ -n "$copilot_root" ]; then
  if [ ! -e "$copilot_rule" ] && [ ! -L "$copilot_rule" ]; then
    mkdir -p "${copilot_rule%/*}" && ln -s "$HOME/AGENTS.md" "$copilot_rule"
  fi
elif [ "$(readlink "$copilot_rule" 2>/dev/null)" = "$HOME/AGENTS.md" ]; then
  rm -f "$copilot_rule"
fi
unset copilot_rule copilot_root
