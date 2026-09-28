# Debian's /etc/profile resets PATH; restore the tools'.
eval "$(mise env -s bash)"
PATH="$PATH:$HOME/.local/share/aube/bin"
if [ -d /opt/venv/bin ]; then PATH="/opt/venv/bin:$PATH"; fi
