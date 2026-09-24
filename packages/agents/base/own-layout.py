"""Hands the agent its paths in a root-owned OCI layout: `mise oci build` stamps one owner on every layer.

Usage: own-layout.py <layout-dir> <cache-dir>

The cache keeps each rewritten layer under its input digest, so the layers
images share (the base, apt, the common tools) are rewritten once.
"""

import concurrent.futures
import gzip
import hashlib
import json
import os
import shutil
import sys
import tarfile
import tempfile

AGENT, ROOT = (65532, 0), (0, 0)
AGENT_TREES = ("usr/local/share/mise", "etc/mise", "home/agent", "usr/local/share/ca-certificates", "etc/ssl/certs")
AGENT_PATHS = ("app",)
# openssh-server's postinst generates host keys that every image would share.
DROP = "etc/ssh/ssh_host_"


def owner(name):
    name = name.removeprefix("./").rstrip("/")
    if name in AGENT_PATHS or any(name == t or name.startswith(t + "/") for t in AGENT_TREES):
        return AGENT
    return ROOT


def dropped(name):
    return name.removeprefix("./").startswith(DROP)


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


def own(path, cache):
    """None when the layer is owned right already, else the rewritten layer's descriptor."""
    with open(__file__, "rb") as f:
        rules = hashlib.sha256(f.read()).hexdigest()[:12]
    memo = os.path.join(cache, f"{os.path.basename(path)}.{rules}.json")
    if os.path.exists(memo):
        with open(memo) as f:
            return json.load(f)
    with tarfile.open(path, "r|*") as tar:
        right = all((m.uid, m.gid) == owner(m.name) and not dropped(m.name) for m in tar)
    done = None
    if not right:
        fd, tmp = tempfile.mkstemp(dir=cache)
        with os.fdopen(fd, "wb") as raw:
            packed = Hashing(raw)
            with gzip.GzipFile(filename="", mode="wb", fileobj=packed, mtime=0, compresslevel=6) as gz:
                plain = Hashing(gz)
                with tarfile.open(path, "r|*") as src, \
                        tarfile.open(fileobj=plain, mode="w|", format=tarfile.PAX_FORMAT) as dst:
                    for m in src:
                        if dropped(m.name):
                            continue
                        m.uid, m.gid = owner(m.name)
                        m.uname = m.gname = ""
                        dst.addfile(m, src.extractfile(m) if m.isreg() else None)
        os.replace(tmp, os.path.join(cache, packed.sha.hexdigest()))
        done = {"digest": packed.digest(), "size": packed.size, "diff_id": plain.digest()}
    with open(memo, "w") as f:
        json.dump(done, f)
    return done


def main(layout, cache):
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
    os.makedirs(cache, exist_ok=True)
    with concurrent.futures.ProcessPoolExecutor() as pool:
        owned = list(pool.map(own, [blob(l["digest"]) for l in manifest["layers"]], [cache] * len(manifest["layers"])))
    for i, (layer, done) in enumerate(zip(manifest["layers"], owned)):
        if done is None:
            continue
        stale.add(layer["digest"])
        if not os.path.exists(blob(done["digest"])):
            shutil.copyfile(os.path.join(cache, done["digest"].split(":", 1)[1]), blob(done["digest"]))
        layer.update(digest=done["digest"], size=done["size"], mediaType="application/vnd.oci.image.layer.v1.tar+gzip")
        layer.get("annotations", {}).pop("dev.mise.layer.owner", None)
        config["rootfs"]["diff_ids"][i] = done["diff_id"]
    manifest["config"]["digest"], manifest["config"]["size"] = put(json.dumps(config).encode())
    desc["digest"], desc["size"] = put(json.dumps(manifest).encode())
    with open(index_path, "w") as f:
        json.dump(index, f, indent=2)
    live = {desc["digest"], manifest["config"]["digest"], *(l["digest"] for l in manifest["layers"])}
    for digest in stale - live:
        os.remove(blob(digest))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
