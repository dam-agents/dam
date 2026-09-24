# Debian's /etc/profile resets PATH; restore the tools'.
eval "$(mise env -s bash)"
PATH="$HOME/.local/share/aube/bin:$PATH"
if [ -d /opt/venv/bin ]; then PATH="/opt/venv/bin:$PATH"; fi
