import { connect as tlsConnect } from "node:tls";
import type { ClusterCaProbe } from "api-server-api";
import { parseClusterEndpoint } from "../domain/kubernetes-contributions.js";

const PROBE_TIMEOUT_MS = 5000;

/** Dial `host[:port]` (default 443) with full TLS validation and report
 *  whether the endpoint is publicly trusted — nothing sent, nothing fetched.
 *  Validation stays on (no `rejectUnauthorized: false`): we don't pin
 *  untrusted certs, so there's nothing to inspect insecurely. See
 *  ClusterCaProbe for the trusted/reachable outcomes. */
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

    // TCP connect fires before the TLS handshake, so a later error means
    // reached-but-untrusted rather than a connection-level failure.
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
