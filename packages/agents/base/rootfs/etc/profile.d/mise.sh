# Debian's /etc/profile resets PATH; restore the tools'.
eval "$(mise env -s bash)"
# mise does not count the npm tools the image build installed through aube as
# installed, so their bin directories are added from the install tree itself.
for d in "${MISE_DATA_DIR:-/usr/local/share/mise}"/installs/npm-*/*/node_modules/.bin; do
  case ":$PATH:" in *":$d:"*) ;; *) [ -d "$d" ] && PATH="$PATH:$d" ;; esac
done
PATH="$PATH:$HOME/.local/share/aube/bin"
if [ -d /opt/venv/bin ]; then PATH="/opt/venv/bin:$PATH"; fi
# agent-browser always means the browser the user sees in the panel.
PATH="/usr/local/lib/platform-browser/bin:$PATH"
