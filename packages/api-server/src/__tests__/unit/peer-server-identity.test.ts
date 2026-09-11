// TEST_OVERVIEW: the peer server end to end, with real certificates from one authority — the situation that matters, because the install has exactly one and it signs every gateway's certificate as well as every node's. What is pinned is the outcome rather than the mechanism: a certificate shaped like a gateway's gets no workspace, whether it is TLS that turns it away for not being issued to authenticate a client or the server's own check of what the certificate is. Both are in force, and this fails if either stops being.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect as tlsConnect } from "node:tls";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startPeerServer,
  type PeerServer,
} from "../../modules/nodes/infrastructure/peer-link.js";

const dir = mkdtempSync(join(tmpdir(), "peer-id-"));
const ssl = (args: string[]) =>
  execFileSync("openssl", args, { cwd: dir, stdio: "pipe" });

function leaf(name: string, usage: string, san: string) {
  ssl([
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    `${name}.key`,
    "-out",
    `${name}.csr`,
    "-subj",
    `/CN=${name}`,
  ]);
  writeFileSync(
    join(dir, `${name}.ext`),
    `keyUsage = critical,digitalSignature,keyEncipherment\nextendedKeyUsage = ${usage}\nsubjectAltName = ${san}\n`,
  );
  ssl([
    "x509",
    "-req",
    "-in",
    `${name}.csr`,
    "-CA",
    "ca.crt",
    "-CAkey",
    "ca.key",
    "-set_serial",
    `0x${Date.now().toString(16)}`,
    "-days",
    "2",
    "-extfile",
    `${name}.ext`,
    "-out",
    `${name}.crt`,
  ]);
  return {
    cert: readFileSync(join(dir, `${name}.crt`), "utf8"),
    key: readFileSync(join(dir, `${name}.key`), "utf8"),
  };
}

let server: PeerServer;
let port: number;
let ca: string;
let node: { cert: string; key: string };
let gateway: { cert: string; key: string };

beforeAll(async () => {
  ssl([
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    "ca.key",
    "-out",
    "ca.crt",
    "-days",
    "2",
    "-subj",
    "/CN=Platform install CA",
  ]);
  ca = readFileSync(join(dir, "ca.crt"), "utf8");
  node = leaf(
    "node-1",
    "serverAuth,clientAuth",
    "DNS:node-1,DNS:platform-node",
  );
  // Exactly what every agent's gateway is issued: the same authority, the
  // hosts it terminates, and serving only.
  gateway = leaf("gateway", "serverAuth", "DNS:api.anthropic.com");

  port = 24_000 + Math.floor(Math.random() * 1000);
  server = await startPeerServer({
    port,
    credentials: { ca, cert: node.cert, key: node.key },
    localAddressOf: () => null,
    exportWorkspace: async (_agentId, out) => {
      out.write("WORKSPACE-BYTES");
      out.end();
    },
    log: () => {},
  });
}, 30_000);

afterAll(async () => server?.close());

function ask(who: { cert: string; key: string }): Promise<string> {
  return new Promise((resolve) => {
    let got = "";
    const socket = tlsConnect(
      {
        host: "127.0.0.1",
        port,
        ca,
        cert: who.cert,
        key: who.key,
        servername: "platform-node",
      },
      () => socket.write("export agent-1\n"),
    );
    socket.on("data", (b: Buffer) => (got += b.toString()));
    socket.on("close", () => resolve(got));
    socket.on("error", () => resolve(got));
  });
}

describe("who the peer server will export a workspace to", () => {
  it("serves a node", async () => {
    expect(await ask(node)).toContain("WORKSPACE-BYTES");
  });

  // TEST_SCENARIO: a gateway's certificate asking for an agent's workspace. Its chain verifies, since one authority signs both, and it is refused anyway.
  it("gives a gateway nothing", async () => {
    expect(await ask(gateway)).toBe("");
  });
});
