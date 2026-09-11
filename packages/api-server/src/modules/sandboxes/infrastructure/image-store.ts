import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { exec } from "./exec.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Turns an image reference into a rootfs directory
 * on the node, speaking the registry API directly. There is no container
 * runtime under this: a daemon that pulls, unpacks and hands back a snapshot
 * is a second control plane over the same job, and the job is a manifest, some
 * blobs and tar. The result is content-addressed by manifest digest and shared
 * read-only by every sandbox on that image, so pulling it twice costs nothing
 * and no sandbox can write into what another one reads. An absolute path in
 * place of a reference is a saved image archive on the node, which is how an
 * image built here rather than pushed somewhere reaches a sandbox: a
 * `docker save` / `podman save` tarball, whose `manifest.json` names the
 * config blob and the layer tarballs in order inside the same archive.
 *
 * The image's config blob is read along with its layers: it carries the PATH,
 * entrypoint and working directory the image was built against, and ignoring
 * it is how an image that runs everywhere else fails to find its own binary.
 *
 * Ownership is preserved and setuid bits are not: the node refuses to mint
 * setuid files at all, and inside the sandbox they would elevate nothing
 * anyway, since it runs with an empty capability set and no-new-privileges.
 * Directory modes are then repaired, because gVisor's root has no DAC
 * override and an image that ships a read-only directory would be one the
 * agent could never write into.
 *
 * One image is unpacked once at a time. Placement hands a fresh node several
 * agents at once and they share an image, so without this they race into the
 * same directory: the second one clears what the first is still writing, and
 * the agent that loses fails to start with a filesystem error naming a path no
 * one asked for. Everything waits on the first unpack and then finds it ready.
 */

const MANIFEST_TYPES = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

const INDEX_TYPES = new Set([
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
]);

export interface ImageConfig {
  env: string[];
  entrypoint: string[];
  cmd: string[];
  workingDir: string;
  user: string;
}

export interface Image {
  rootfs: string;
  config: ImageConfig;
}

export interface ImageStore {
  ensure(reference: string, opts?: { authDir?: string }): Promise<Image>;
}

interface Descriptor {
  mediaType: string;
  digest: string;
  size: number;
  platform?: { os?: string; architecture?: string };
}

interface Manifest {
  mediaType?: string;
  manifests?: Descriptor[];
  layers?: Descriptor[];
  config?: Descriptor;
}

interface ImageRef {
  registry: string;
  repository: string;
  reference: string;
}

export function createImageStore(opts: {
  root: string;
  arch?: string;
  log: (message: string, fields?: Record<string, unknown>) => void;
}): ImageStore {
  const arch = opts.arch ?? (process.arch === "arm64" ? "arm64" : "amd64");
  const unpacking = new Map<string, Promise<ImageConfig>>();

  function unpack(
    dir: string,
    write: (rootfs: string) => Promise<unknown>,
  ): Promise<ImageConfig> {
    const running = unpacking.get(dir);
    if (running) return running;
    const work = unpackOnce(dir, write).finally(() => unpacking.delete(dir));
    unpacking.set(dir, work);
    return work;
  }

  async function unpackOnce(
    dir: string,
    write: (rootfs: string) => Promise<unknown>,
  ): Promise<ImageConfig> {
    const rootfs = join(dir, "rootfs");
    const configPath = join(dir, "config.json");
    if (await exists(join(dir, ".ready"))) {
      return readConfig(JSON.parse(await readFile(configPath, "utf8")));
    }
    await rm(dir, { recursive: true, force: true });
    await mkdir(rootfs, { recursive: true, mode: 0o755 });
    const config = await write(rootfs);
    await writeFile(configPath, JSON.stringify(config));
    await exec("find", [
      rootfs,
      "-xdev",
      "-type",
      "d",
      "!",
      "-perm",
      "-200",
      "-exec",
      "chmod",
      "u+w",
      "{}",
      "+",
    ]).catch(() => {});
    await writeFile(join(dir, ".ready"), "");
    return readConfig(config);
  }

  return {
    async ensure(reference, { authDir } = {}) {
      if (reference.startsWith("/")) {
        const stamp = await stat(reference);
        const digest = createHash("sha256")
          .update(`${reference}:${stamp.mtimeMs}:${stamp.size}`)
          .digest("hex");
        const dir = join(opts.root, `archive_${digest}`);
        opts.log("image.load.begin", { reference });
        const config = await unpack(dir, (rootfs) =>
          applyArchive(reference, rootfs),
        );
        opts.log("image.load.done", { reference });
        return { rootfs: join(dir, "rootfs"), config };
      }

      const ref = parseRef(reference);
      const auth = await readRegistryAuth(authDir, ref.registry);
      const token = await authorize(ref, auth);

      const { manifest, digest } = await fetchManifest(ref, token, arch);
      const dir = join(opts.root, digest.replace(":", "_"));
      opts.log("image.pull.begin", { reference, digest });
      const config = await unpack(dir, async (rootfs) => {
        const blob = manifest.config
          ? await fetchBlobJson(ref, token, manifest.config.digest)
          : {};
        for (const layer of manifest.layers ?? []) {
          await applyLayer(ref, token, layer, rootfs);
        }
        return blob;
      });
      opts.log("image.pull.done", { reference, digest });
      return { rootfs: join(dir, "rootfs"), config };
    },
  };
}

async function applyArchive(path: string, rootfs: string): Promise<unknown> {
  const scratch = await mkdtemp(join(tmpdir(), "dam-archive-"));
  try {
    await exec("tar", ["--extract", "--file", path, "--directory", scratch]);
    const entries = JSON.parse(
      await readFile(join(scratch, "manifest.json"), "utf8"),
    ) as { Config?: string; Layers?: string[] }[];
    const entry = entries[0];
    if (!entry?.Config) throw new Error(`${path} is not a saved image archive`);
    for (const layer of entry.Layers ?? []) {
      const blob = join(scratch, layer);
      const listing = await exec("tar", ["--list", "--file", blob]);
      await exec("tar", [
        "--extract",
        "--file",
        blob,
        "--directory",
        rootfs,
        "--overwrite",
        "--same-owner",
        "--no-same-permissions",
        "--delay-directory-restore",
      ]);
      await applyWhiteouts(rootfs, listing.split("\n"));
    }
    return JSON.parse(await readFile(join(scratch, entry.Config), "utf8"));
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export function parseRef(reference: string): ImageRef {
  const at = reference.lastIndexOf("@");
  let rest = reference;
  let tagOrDigest = "latest";
  if (at > 0) {
    tagOrDigest = reference.slice(at + 1);
    rest = reference.slice(0, at);
  } else {
    const colon = rest.lastIndexOf(":");
    const slash = rest.lastIndexOf("/");
    if (colon > slash) {
      tagOrDigest = rest.slice(colon + 1);
      rest = rest.slice(0, colon);
    }
  }
  const parts = rest.split("/");
  const hasRegistry =
    parts.length > 1 &&
    (parts[0]!.includes(".") ||
      parts[0]!.includes(":") ||
      parts[0] === "localhost");
  const named = hasRegistry ? parts.shift()! : "docker.io";
  const registry =
    named === "docker.io" || named === "index.docker.io"
      ? "registry-1.docker.io"
      : named;
  const repository =
    registry === "registry-1.docker.io" && parts.length === 1
      ? `library/${parts[0]}`
      : parts.join("/");
  return { registry, repository, reference: tagOrDigest };
}

async function readRegistryAuth(
  authDir: string | undefined,
  registry: string,
): Promise<string | null> {
  if (!authDir) return null;
  try {
    const config = JSON.parse(
      await readFile(join(authDir, "config.json"), "utf8"),
    ) as { auths?: Record<string, { auth?: string }> };
    for (const [host, entry] of Object.entries(config.auths ?? {})) {
      if (
        host === registry ||
        host.endsWith(`/${registry}`) ||
        registry.endsWith(host)
      ) {
        return entry.auth ?? null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function authorize(
  ref: ImageRef,
  basic: string | null,
): Promise<string | null> {
  const probe = await fetch(
    `https://${ref.registry}/v2/${ref.repository}/manifests/${ref.reference}`,
    { method: "HEAD", headers: { Accept: MANIFEST_TYPES } },
  );
  if (probe.status !== 401) return basic ? `Basic ${basic}` : null;

  const challenge = probe.headers.get("www-authenticate") ?? "";
  const realm = /realm="([^"]+)"/.exec(challenge)?.[1];
  if (!realm) return basic ? `Basic ${basic}` : null;
  const service = /service="([^"]+)"/.exec(challenge)?.[1];
  const url = new URL(realm);
  if (service) url.searchParams.set("service", service);
  url.searchParams.set("scope", `repository:${ref.repository}:pull`);

  const res = await fetch(url, {
    headers: basic ? { Authorization: `Basic ${basic}` } : {},
  });
  if (!res.ok)
    throw new Error(`registry auth failed: ${res.status} ${url.host}`);
  const body = (await res.json()) as { token?: string; access_token?: string };
  const token = body.token ?? body.access_token;
  return token ? `Bearer ${token}` : null;
}

async function fetchManifest(
  ref: ImageRef,
  token: string | null,
  arch: string,
): Promise<{ manifest: Manifest; digest: string }> {
  const get = async (reference: string) => {
    const res = await fetch(
      `https://${ref.registry}/v2/${ref.repository}/manifests/${reference}`,
      {
        headers: {
          Accept: MANIFEST_TYPES,
          ...(token ? { Authorization: token } : {}),
        },
      },
    );
    if (!res.ok) {
      throw new Error(
        `pulling ${ref.repository}:${reference} failed: ${res.status} ${res.statusText}`,
      );
    }
    const body = await res.text();
    return {
      manifest: JSON.parse(body) as Manifest,
      digest:
        res.headers.get("docker-content-digest") ??
        `sha256:${createHash("sha256").update(body).digest("hex")}`,
    };
  };

  const first = await get(ref.reference);
  if (!INDEX_TYPES.has(first.manifest.mediaType ?? "")) return first;

  const match = (first.manifest.manifests ?? []).find(
    (m) => m.platform?.os === "linux" && m.platform?.architecture === arch,
  );
  if (!match) {
    throw new Error(
      `${ref.repository}:${ref.reference} has no linux/${arch} image`,
    );
  }
  return get(match.digest);
}

async function fetchBlobJson(
  ref: ImageRef,
  token: string | null,
  digest: string,
): Promise<unknown> {
  const res = await fetch(
    `https://${ref.registry}/v2/${ref.repository}/blobs/${digest}`,
    { headers: token ? { Authorization: token } : {}, redirect: "follow" },
  );
  if (!res.ok)
    throw new Error(`fetching config ${digest} failed: ${res.status}`);
  return res.json();
}

function readConfig(blob: unknown): ImageConfig {
  const config = (blob as { config?: Record<string, unknown> })?.config ?? {};
  const list = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);
  return {
    env: list(config.Env),
    entrypoint: list(config.Entrypoint),
    cmd: list(config.Cmd),
    workingDir: typeof config.WorkingDir === "string" ? config.WorkingDir : "/",
    user: typeof config.User === "string" ? config.User : "",
  };
}

async function applyLayer(
  ref: ImageRef,
  token: string | null,
  layer: Descriptor,
  rootfs: string,
): Promise<void> {
  const res = await fetch(
    `https://${ref.registry}/v2/${ref.repository}/blobs/${layer.digest}`,
    { headers: token ? { Authorization: token } : {}, redirect: "follow" },
  );
  if (!res.ok || !res.body) {
    throw new Error(`fetching layer ${layer.digest} failed: ${res.status}`);
  }

  const scratch = await mkdtemp(join(tmpdir(), "dam-layer-"));
  const blob = join(scratch, "layer.tar");
  try {
    await pipeline(
      Readable.fromWeb(res.body as never),
      createWriteStream(blob),
    );
    const listing = await exec("tar", ["--list", "--file", blob]);
    await exec("tar", [
      "--extract",
      "--file",
      blob,
      "--directory",
      rootfs,
      "--overwrite",
      "--same-owner",
      "--no-same-permissions",
      "--delay-directory-restore",
    ]);
    await applyWhiteouts(rootfs, listing.split("\n"));
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function applyWhiteouts(
  rootfs: string,
  entries: string[],
): Promise<void> {
  const provided = new Set(
    entries.map((e) => e.replace(/^\.\//, "").replace(/\/$/, "")),
  );
  for (const entry of entries) {
    const path = entry.replace(/^\.\//, "");
    const base = path.split("/").pop() ?? "";
    if (!base.startsWith(".wh.")) continue;
    const marker = join(rootfs, path);

    if (base === ".wh..wh..opq") {
      const dir = dirname(marker);
      for (const child of await readdir(dir).catch(() => [])) {
        const rel = relative(rootfs, join(dir, child));
        if (!provided.has(rel)) {
          await rm(join(dir, child), { recursive: true, force: true });
        }
      }
    } else {
      const target = join(dirname(marker), base.slice(".wh.".length));
      await rm(target, { recursive: true, force: true });
    }
    await rm(marker, { force: true });
  }
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );
