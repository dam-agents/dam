# Sourced by the image tasks that need a Linux host of the image's arch
# (`mise oci`, a native cargo build). Off Linux they build in the dev cluster's
# Lima VM ($AGENT_BUILD_VM, default platform-k3s, else $LIMA_INSTANCE),
# whichever cluster imports the result: its disk holds the build cache, which
# the e2e VM's has no room for.
LIMA_BUILD_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIMA_BUILD_VM="${AGENT_BUILD_VM:-platform-k3s}"
limactl list -q 2>/dev/null | grep -qx "$LIMA_BUILD_VM" || LIMA_BUILD_VM="${LIMA_INSTANCE:-$LIMA_BUILD_VM}"

# lima_build <apt packages> <mise tools> <command> [arg]...: runs the command
# with those tools in ~/platform-src, a copy of the working tree (the host's
# node_modules are not Linux's), the tools CI's build job sets up rather than
# the repo's whole toolchain. The host's GitHub token goes to the VM's mise on
# stdin, ahead of the tree, to stay out of process lists.
# Every worktree builds in this one copy, against one cargo target, and cargo
# takes a source whose mtime is older than its last build for unchanged. So the
# tree is synced in by content: a file whose content differs gets a new mtime
# and is rebuilt, and an unchanged one keeps its mtime and its build, whichever
# worktree built last. A lock holds the copy for one build at a time, so two
# builds never share it while one replaces it.
lima_build() {
  local apt="$1" tools="$2"
  shift 2
  limactl list -q 2>/dev/null | grep -qx "$LIMA_BUILD_VM" ||
    { echo "no Lima VM $LIMA_BUILD_VM: run mise run cluster:install first" >&2; return 1; }
  {
    printf '%s\n' "${GITHUB_TOKEN:-$(gh auth token 2>/dev/null || true)}"
    cd "$LIMA_BUILD_REPO"
    git ls-files -z --cached --others --exclude-standard |
      while IFS= read -r -d '' f; do { [ -e "$f" ] || [ -L "$f" ]; } && printf '%s\0' "$f"; done |
      tar --null -T - -cf -
  } | limactl shell --workdir / "$LIMA_BUILD_VM" sh -c '
    set -e
    read -r GITHUB_TOKEN || true
    [ -z "$GITHUB_TOKEN" ] || export GITHUB_TOKEN
    want=$1 apt="rsync $2" tools=$3
    shift 3
    missing=$(for p in $apt; do dpkg -s "$p" >/dev/null 2>&1 || echo "$p"; done)
    [ -z "$missing" ] || { sudo apt-get update -qq && sudo apt-get install -y -qq $missing; }
    exec 9>~/.platform-src.lock
    flock 9
    rm -rf ~/platform-src.new && mkdir ~/platform-src.new && tar -C ~/platform-src.new -xf -
    mkdir -p ~/platform-src
    rsync -rlpc --delete ~/platform-src.new/ ~/platform-src/
    rm -rf ~/platform-src.new
    [ -x ~/.local/bin/mise ] || curl -fsSL https://mise.run | sh
    ~/.local/bin/mise self-update --yes "$want" >/dev/null
    export PATH="$HOME/.local/bin:$PATH"
    cd ~/platform-src
    mise trust -q
    mise exec --no-deps $tools -- "$@"' _ "$(mise config get -f "$LIMA_BUILD_REPO/.mise/config.toml" min_version)" "$apt" "$tools" "$@"
}

# lima_cat <path>: a file lima_build wrote, by its path in ~/platform-src.
lima_cat() {
  limactl shell --workdir / "$LIMA_BUILD_VM" sh -c 'cat ~/platform-src/"$1"' _ "$1"
}
