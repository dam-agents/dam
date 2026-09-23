#!/bin/sh
# postinstall hook for the image's python: the same pip removal and `uv pip`
# shim platform-base applies in its Dockerfile (see the reasoning there). It runs
# on the build host against the host install, before `mise oci build` packages
# that install as the python layer.
set -eu

W="$MISE_TOOL_INSTALL_PATH"
sp="$(echo "$W"/lib/python3.*/site-packages)"
sh "$(dirname "$0")/drop-pip.sh" "$W/bin/python3"
mkdir "$sp/pip"
printf '__version__ = "24.3.1"\n' > "$sp/pip/__init__.py"
cat > "$sp/pip/__main__.py" <<'PY'
import os, sys

from pip import __version__

# `uv pip --version` is an error, and everything probes `pip --version`.
if sys.argv[1:2] in (["--version"], ["-V"]):
    print(f"pip {__version__} (uv shim)")
    raise SystemExit(0)

os.environ["UV_PYTHON"] = sys.executable
os.execvp("uv", ["uv", "pip", *sys.argv[1:]])
PY
for b in pip pip3; do
	printf '#!/bin/sh\nexec "$(dirname -- "$(realpath -- "$0")")/python3" -m pip "$@"\n' > "$W/bin/$b"
	chmod 755 "$W/bin/$b"
done
