// mTLS/handshake tests: generate a throwaway private CA + server and client
// leaves with openssl (the same shape Secrets Manager emits), start the real
// server, and check that a CA-signed client gets in (reaching the pre-Incus
// argv check) while a client with no cert is rejected at the TLS layer. No
// Incus, no DAM required.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

const pkgDir = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = mkdtempSync(join(tmpdir(), "dam-vm-mtls-"));
const p = (f) => join(dir, f);
// args split on spaces — fine here, tmpdir paths and subjects have none
const ossl = (cmd) =>
  execFileSync("openssl", cmd.split(" "), { stdio: "ignore" });
const leaf = (file, cn, ext = "") => {
  ossl(
    `req -newkey rsa:2048 -nodes -keyout ${p(file + ".key")} -out ${p(file + ".csr")} -subj /CN=${cn}`,
  );
  ossl(
    `x509 -req -in ${p(file + ".csr")} -CA ${p("ca.crt")} -CAkey ${p("ca.key")} -CAcreateserial -days 1 -out ${p(file + ".crt")}${ext}`,
  );
};

let server, port, clientCert, clientKey, caCert;

before(async () => {
  ossl(
    `req -x509 -newkey rsa:2048 -nodes -days 1 -keyout ${p("ca.key")} -out ${p("ca.crt")} -subj /CN=test-ca`,
  );
  // server leaf with an IP SAN so the client validates it at 127.0.0.1
  writeFileSync(p("san.ext"), "subjectAltName=IP:127.0.0.1,DNS:localhost\n");
  leaf("srv", "dam-vm", ` -extfile ${p("san.ext")}`);
  // client leaves signed by the same CA: a canonical CN (= cluster id) and a
  // hyphenated one (hyphens would make container names ambiguous → rejected)
  leaf("cli", "testcluster");
  leaf("hyph", "test-cluster");
  clientCert = readFileSync(p("cli.crt"), "utf8");
  clientKey = readFileSync(p("cli.key"), "utf8");
  caCert = readFileSync(p("ca.crt"), "utf8");

  server = spawn(process.execPath, [join(pkgDir, "dam-vm-server.mjs")], {
    env: {
      ...process.env,
      DAM_VM_TLS_CERT_FILE: p("srv.crt"),
      DAM_VM_TLS_KEY_FILE: p("srv.key"),
      DAM_VM_CLIENT_CA_FILE: p("ca.crt"),
      DAM_VM_PORT: "0",
      DAM_VM_LISTEN_HOST: "127.0.0.1",
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  port = await new Promise((resolve, reject) => {
    let out = "";
    server.stdout.on("data", (d) => {
      out += d;
      const m = out.match(/on 127\.0\.0\.1:(\d+)/);
      if (m) resolve(Number(m[1]));
    });
    server.on("exit", (code) =>
      reject(new Error(`server exited ${code}: ${out}`)),
    );
    setTimeout(
      () => reject(new Error(`server start timeout: ${out}`)),
      10_000,
    ).unref();
  });
});
after(() => server?.kill());

const closeOf = (opts, params, headers) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `wss://127.0.0.1:${port}/run?${new URLSearchParams(params)}`,
      { ca: caCert, headers, ...opts },
    );
    ws.on("error", (e) => resolve({ error: e.code || e.message }));
    ws.on("close", (code, reason) =>
      resolve({ code, reason: reason.toString() }),
    );
    setTimeout(() => reject(new Error("no close/error event")), 5000).unref();
  });

const ARGV = Buffer.from(JSON.stringify(["true"])).toString("base64");
const AGENT = { "x-dam-vm-agent": "a1" };

test("rejects a client with no cert at the TLS layer", async () => {
  const r = await closeOf({}, { argv: ARGV }, AGENT);
  // No mutual-TLS cert → handshake fails; never reaches a WS close code.
  assert.ok(r.error, `expected a TLS error, got ${JSON.stringify(r)}`);
});

test("accepts a CA-signed client, then rejects bad argv before provisioning", async () => {
  const r = await closeOf(
    { cert: clientCert, key: clientKey },
    { argv: "%%%" },
    AGENT,
  );
  assert.deepEqual(r, { code: 4400, reason: "bad argv" });
});

test("rejects a malformed agent id (authenticated client)", async () => {
  const r = await closeOf(
    { cert: clientCert, key: clientKey },
    { argv: ARGV },
    { "x-dam-vm-agent": "Not.Valid" },
  );
  assert.deepEqual(r, { code: 4400, reason: "bad agent id" });
});

test("rejects a CA-signed client whose CN is not a canonical cluster id", async () => {
  const r = await closeOf(
    { cert: readFileSync(p("hyph.crt")), key: readFileSync(p("hyph.key")) },
    { argv: ARGV },
    AGENT,
  );
  assert.deepEqual(r, { code: 4401, reason: "client cert has no usable CN" });
});
