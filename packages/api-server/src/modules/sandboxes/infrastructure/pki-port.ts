import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exec } from "./exec.js";
import type { InstallCaStore } from "./install-ca-store.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The install's certificate authority. One CA is
 * generated once and shared by every node, because an agent trusts the CA its
 * node hands it and may be placed on a different node tomorrow — a CA per node
 * would make the trust anchor a property of where the agent happens to run.
 * The sandbox trusting it is what lets its paired gateway terminate the agent's
 * TLS and inject a credential. Each gateway's leaf names exactly the hosts its
 * chains terminate, so a host with no chain cannot be intercepted — and an
 * agent that terminates nothing gets a leaf with no subjectAltName at all,
 * rather than an openssl config naming an empty section, which openssl refuses
 * outright.
 *
 * Leaves carry a random serial rather than a counter file next to the CA: the
 * counter is node-local, and two nodes signing from one CA would hand out the
 * same serial twice.
 *
 * A node upgraded from the single-node install already has a CA on its disk.
 * That one is adopted as the install's rather than a fresh one being minted,
 * which keeps every existing agent's trust anchor instead of rotating the
 * whole install out from under the sandboxes already running.
 */
export interface PkiPort {
  ensureCa(): Promise<string>;
  ensureLeaf(dir: string, hosts: readonly string[]): Promise<void>;
}

const LEAF_DAYS = 825;
const CA_DAYS = 3650;

export function createPkiPort(caDir: string, store: InstallCaStore): PkiPort {
  const caCert = join(caDir, "ca.crt");
  const caKey = join(caDir, "ca.key");
  let cached: string | null = null;

  return {
    async ensureCa() {
      if (cached) return cached;
      const ca =
        (await store.load()) ??
        (await store.claim(
          (await readLocalCa(caCert, caKey)) ?? (await generateCa()),
        ));
      await mkdir(caDir, { recursive: true, mode: 0o700 });
      await writeFile(caCert, ca.cert, { mode: 0o644 });
      await writeFile(caKey, ca.key, { mode: 0o600 });
      cached = ca.cert;
      return ca.cert;
    },

    async ensureLeaf(dir, hosts) {
      const sanFile = join(dir, "san.cnf");
      const san = hosts.map((h, i) => `DNS.${i + 1} = ${h}`).join("\n");
      const alt = hosts.length ? `subjectAltName = @alt\n` : "";
      const altSection = hosts.length ? `[alt]\n${san}\n` : "";
      const config = `[req]\ndistinguished_name = dn\n[dn]\n[ext]\n${alt}keyUsage = critical,digitalSignature,keyEncipherment\nextendedKeyUsage = serverAuth\n${altSection}`;

      if ((await readIfPresent(sanFile)) === config) return;

      await mkdir(dir, { recursive: true, mode: 0o750 });
      await writeFile(sanFile, config, { mode: 0o640 });
      const key = join(dir, "tls.key");
      const csr = join(dir, "tls.csr");
      const cert = join(dir, "tls.crt");
      await exec("openssl", [
        "req",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        key,
        "-out",
        csr,
        "-subj",
        "/CN=platform-gateway",
        "-config",
        sanFile,
      ]);
      await exec("openssl", [
        "x509",
        "-req",
        "-in",
        csr,
        "-CA",
        caCert,
        "-CAkey",
        caKey,
        "-set_serial",
        `0x${randomBytes(16).toString("hex")}`,
        "-out",
        cert,
        "-days",
        String(LEAF_DAYS),
        "-extensions",
        "ext",
        "-extfile",
        sanFile,
      ]);
    },
  };
}

async function readLocalCa(
  certPath: string,
  keyPath: string,
): Promise<{ cert: string; key: string } | null> {
  const [cert, key] = await Promise.all([
    readFile(certPath, "utf8").catch(() => null),
    readFile(keyPath, "utf8").catch(() => null),
  ]);
  return cert && key ? { cert, key } : null;
}

async function generateCa(): Promise<{ cert: string; key: string }> {
  const dir = await mkdtemp(join(tmpdir(), "dam-ca-"));
  try {
    const cert = join(dir, "ca.crt");
    const key = join(dir, "ca.key");
    await exec("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:4096",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      String(CA_DAYS),
      "-subj",
      "/CN=Platform egress CA",
      "-addext",
      "basicConstraints=critical,CA:TRUE,pathlen:0",
      "-addext",
      "keyUsage=critical,keyCertSign,cRLSign",
    ]);
    return {
      cert: await readFile(cert, "utf8"),
      key: await readFile(key, "utf8"),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function readIfPresent(path: string): Promise<string | null> {
  return readFile(path, "utf8").catch(() => null);
}
