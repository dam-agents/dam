# Copilot finds the home's AGENTS.md only when $HOME is the git root of the
# work dir, so the home joins the image's instructions directories.
COPILOT_CUSTOM_INSTRUCTIONS_DIRS="${COPILOT_CUSTOM_INSTRUCTIONS_DIRS:+$COPILOT_CUSTOM_INSTRUCTIONS_DIRS,}$HOME"
export COPILOT_CUSTOM_INSTRUCTIONS_DIRS
