"""Give the agent user the paths it writes, in an OCI layout built root-owned.

mise oci build stamps one owner on every layer it generates, so the image is
built as root and the entries under AGENT_TREES and AGENT_PATHS are handed to
the agent here, the way the Fedora image's Dockerfile chowned them. Everything
else, /etc/claude-code/managed-settings.json included, stays root's.

Usage: own-layout.py <layout-dir>
"""

import gzip
import hashlib
import json
import os
import sys
import tarfile
import tempfile

AGENT = (65532, 0)
ROOT = (0, 0)
# Owned by the agent with everything under them: the tool installs mise and npm
# add to, the global mise config, the home, the working-dir seed, the trust
# store the entrypoint extends with the platform CA, and the shipped skills.
AGENT_TREES = (
    "usr/local/share/mise",
    "etc/mise",
    "home/agent",
    "app/working-dir",
    "usr/local/share/ca-certificates",
    "etc/ssl/certs",
    "usr/local/share/dam-skills",
)
# Owned by the agent themselves only.
AGENT_PATHS = ("app", "usr/local/share/dam-skill-manifest.json")


def wanted(name):
    name = name.removeprefix("./").rstrip("/")
    if name in AGENT_PATHS or any(name == t or name.startswith(t + "/") for t in AGENT_TREES):
        return AGENT
    return ROOT


def blob(layout, digest):
    return os.path.join(layout, "blobs", *digest.split(":", 1))


def put(layout, data):
    digest = "sha256:" + hashlib.sha256(data).hexdigest()
    with open(blob(layout, digest), "wb") as f:
        f.write(data)
    return digest, len(data)


def needs_rewrite(path):
    with tarfile.open(path, "r|*") as tar:
        return any((m.uid, m.gid) != wanted(m.name) for m in tar)


class Hashing:
    def __init__(self, inner):
        self.inner, self.sha = inner, hashlib.sha256()

    def write(self, data):
        self.sha.update(data)
        return self.inner.write(data)


def rewrite(layout, path):
    """Re-owns one layer; returns its new (digest, size, diff_id)."""
    fd, tmp = tempfile.mkstemp(dir=os.path.join(layout, "blobs"))
    with os.fdopen(fd, "wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as gz:
            plain = Hashing(gz)
            with tarfile.open(path, "r|*") as src, tarfile.open(fileobj=plain, mode="w|", format=tarfile.PAX_FORMAT) as dst:
                for m in src:
                    m.uid, m.gid = wanted(m.name)
                    m.uname = m.gname = ""
                    dst.addfile(m, src.extractfile(m) if m.isreg() else None)
    sha = hashlib.sha256()
    with open(tmp, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            sha.update(chunk)
    digest = "sha256:" + sha.hexdigest()
    os.replace(tmp, blob(layout, digest))
    return digest, os.path.getsize(blob(layout, digest)), "sha256:" + plain.sha.hexdigest()


def main(layout):
    index_path = os.path.join(layout, "index.json")
    with open(index_path) as f:
        index = json.load(f)
    stale = set()
    for desc in index["manifests"]:
        with open(blob(layout, desc["digest"])) as f:
            manifest = json.load(f)
        with open(blob(layout, manifest["config"]["digest"])) as f:
            config = json.load(f)
        for i, layer in enumerate(manifest["layers"]):
            path = blob(layout, layer["digest"])
            if not needs_rewrite(path):
                continue
            digest, size, diff_id = rewrite(layout, path)
            stale.add(layer["digest"])
            layer.update(digest=digest, size=size, mediaType="application/vnd.oci.image.layer.v1.tar+gzip")
            layer.get("annotations", {}).pop("dev.mise.layer.owner", None)
            config["rootfs"]["diff_ids"][i] = diff_id
        stale.add(manifest["config"]["digest"])
        manifest["config"]["digest"], manifest["config"]["size"] = put(layout, json.dumps(config).encode())
        stale.add(desc["digest"])
        desc["digest"], desc["size"] = put(layout, json.dumps(manifest).encode())
    with open(index_path, "w") as f:
        json.dump(index, f, indent=2)
    live = {d["digest"] for d in index["manifests"]}
    for desc in index["manifests"]:
        with open(blob(layout, desc["digest"])) as f:
            manifest = json.load(f)
        live |= {manifest["config"]["digest"], *(l["digest"] for l in manifest["layers"])}
    for digest in stale - live:
        os.remove(blob(layout, digest))


if __name__ == "__main__":
    main(sys.argv[1])
