"""Hands the agent its paths in a root-owned OCI layout: `mise oci build` stamps one owner on every layer.

Usage: own-layout.py <layout-dir>
"""

import gzip
import hashlib
import json
import os
import sys
import tarfile
import tempfile

AGENT, ROOT = (65532, 0), (0, 0)
AGENT_TREES = ("usr/local/share/mise", "etc/mise", "home/agent", "usr/local/share/ca-certificates", "etc/ssl/certs")
AGENT_PATHS = ("app",)


def owner(name):
    name = name.removeprefix("./").rstrip("/")
    if name in AGENT_PATHS or any(name == t or name.startswith(t + "/") for t in AGENT_TREES):
        return AGENT
    return ROOT


class Hashing:
    def __init__(self, inner):
        self.inner, self.sha, self.size = inner, hashlib.sha256(), 0

    def write(self, data):
        self.sha.update(data)
        self.size += len(data)
        return self.inner.write(data)

    def flush(self):
        self.inner.flush()

    def digest(self):
        return "sha256:" + self.sha.hexdigest()


def main(layout):
    blob = lambda digest: os.path.join(layout, "blobs", *digest.split(":", 1))

    def put(data):
        digest = "sha256:" + hashlib.sha256(data).hexdigest()
        with open(blob(digest), "wb") as f:
            f.write(data)
        return digest, len(data)

    def load(digest):
        with open(blob(digest)) as f:
            return json.load(f)

    index_path = os.path.join(layout, "index.json")
    with open(index_path) as f:
        index = json.load(f)
    desc = index["manifests"][0]
    manifest = load(desc["digest"])
    config = load(manifest["config"]["digest"])
    stale = {desc["digest"], manifest["config"]["digest"]}
    for i, layer in enumerate(manifest["layers"]):
        with tarfile.open(blob(layer["digest"]), "r|*") as tar:
            if all((m.uid, m.gid) == owner(m.name) for m in tar):
                continue
        fd, tmp = tempfile.mkstemp(dir=os.path.join(layout, "blobs"))
        with os.fdopen(fd, "wb") as raw:
            packed = Hashing(raw)
            with gzip.GzipFile(filename="", mode="wb", fileobj=packed, mtime=0) as gz:
                plain = Hashing(gz)
                with tarfile.open(blob(layer["digest"]), "r|*") as src, \
                        tarfile.open(fileobj=plain, mode="w|", format=tarfile.PAX_FORMAT) as dst:
                    for m in src:
                        m.uid, m.gid = owner(m.name)
                        m.uname = m.gname = ""
                        dst.addfile(m, src.extractfile(m) if m.isreg() else None)
        stale.add(layer["digest"])
        os.replace(tmp, blob(packed.digest()))
        layer.update(digest=packed.digest(), size=packed.size, mediaType="application/vnd.oci.image.layer.v1.tar+gzip")
        layer.get("annotations", {}).pop("dev.mise.layer.owner", None)
        config["rootfs"]["diff_ids"][i] = plain.digest()
    manifest["config"]["digest"], manifest["config"]["size"] = put(json.dumps(config).encode())
    desc["digest"], desc["size"] = put(json.dumps(manifest).encode())
    with open(index_path, "w") as f:
        json.dump(index, f, indent=2)
    live = {desc["digest"], manifest["config"]["digest"], *(l["digest"] for l in manifest["layers"])}
    for digest in stale - live:
        os.remove(blob(digest))


if __name__ == "__main__":
    main(sys.argv[1])
