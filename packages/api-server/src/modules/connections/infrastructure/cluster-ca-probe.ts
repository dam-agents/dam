import { connect as tlsConnect } from "node:tls";
import type { ClusterCaProbe } from "api-server-api";
import { parseClusterEndpoint } from "../domain/kubernetes-contributions.js";

const PROBE_TIMEOUT_MS = 5000;

/** Dial `host[:port]` (default 443) over TLS with full certificate validation
 *  and report whether the cluster API endpoint is publicly trusted. It sends
 *  no credential and fetches nothing — it completes the handshake and closes.
 *
 *  - `trusted` — the serving cert validates against the system trust store, so
 *    the gateway needs no explicit CA.
 *  - `reachable && !trusted` — the endpoint was reached but its cert isn't
 *    publicly trusted (self-signed / private CA); the caller must supply the CA.
 *  - `!reachable` — the dial itself failed (DNS / refused / timeout).
 *
 *  Validation stays ON (no `rejectUnauthorized: false`): we no longer fetch an
 *  untrusted cert to pin it, so there is nothing to inspect insecurely. */
export async function probeClusterCa(host: string): Promise<ClusterCaProbe> {
  const parsed = parseClusterEndpoint(host);
  const hostname = parsed.host;
  const port = parsed.port ?? 443;
  return new Promise<ClusterCaProbe>((resolve) => {
    let settled = false;
    let tcpConnected = false;
    const done = (r: ClusterCaProbe) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(r);
    };

    const socket = tlsConnect(
      { host: hostname, port, servername: hostname, timeout: PROBE_TIMEOUT_MS },
      () => done({ reachable: true, trusted: true }),
    );

    // The underlying TCP connect fires before the TLS handshake, so a later
    // error means the host was reached but its cert failed validation — a
    // reachable-but-untrusted endpoint, distinct from a connection-level
    // failure (DNS / refused / timeout) where TCP never completed.
    socket.on("connect", () => {
      tcpConnected = true;
    });
    socket.on("timeout", () =>
      done({
        reachable: tcpConnected,
        trusted: false,
        error: tcpConnected
          ? "TLS handshake timed out"
          : "connection timed out",
      }),
    );
    socket.on("error", (err: Error) =>
      done({ reachable: tcpConnected, trusted: false, error: err.message }),
    );
  });
}
