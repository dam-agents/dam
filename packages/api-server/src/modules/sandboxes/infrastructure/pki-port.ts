import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { exec } from "./exec.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The node's own certificate authority. One CA is
 * generated on first boot; the sandbox trusts it, which is what lets its paired
 * gateway terminate the agent's TLS and inject a credential. Each gateway's
 * leaf names exactly the hosts its chains terminate, so a host with no chain
 * cannot be intercepted — and an agent that terminates nothing gets a leaf
 * with no subjectAltName at all, rather than an openssl config naming an empty
 * section, which openssl refuses outright.
 */
export interface PkiPort {
  ensureCa(): Promise<string>;
  ensureLeaf(dir: string, hosts: readonly string[]): Promise<void>;
}

const LEAF_DAYS = 825;
const CA_DAYS = 3650;

export function createPkiPort(caDir: string): PkiPort {
  const caCert = join(caDir, "ca.crt");
  const caKey = join(caDir, "ca.key");

  return {
    async ensureCa() {
      if (!(await exists(caCert))) {
        await mkdir(caDir, { recursive: true, mode: 0o700 });
        await exec("openssl", [
          "req",
          "-x509",
          "-newkey",
          "rsa:4096",
          "-nodes",
          "-keyout",
          caKey,
          "-out",
          caCert,
          "-days",
          String(CA_DAYS),
          "-subj",
          "/CN=Platform egress CA",
          "-addext",
          "basicConstraints=critical,CA:TRUE,pathlen:0",
          "-addext",
          "keyUsage=critical,keyCertSign,cRLSign",
        ]);
      }
      return readFile(caCert, "utf8");
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
        "-CAcreateserial",
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

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function readIfPresent(path: string): Promise<string | null> {
  return readFile(path, "utf8").catch(() => null);
}
