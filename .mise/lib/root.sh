# as_root: runs a command as root — directly when this shell already is root,
# as in a root sandbox that ships no sudo, and through sudo otherwise. Only for
# commands on this machine: one run inside the Lima VM keeps its own sudo.
as_root() {
  if [ "$(id -u)" = 0 ]; then "$@"; else sudo "$@"; fi
}
