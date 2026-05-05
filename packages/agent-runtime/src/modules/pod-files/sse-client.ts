import { request as httpRequest, Agent as HttpAgent } from "node:http";
import { request as httpsRequest, Agent as HttpsAgent } from "node:https";

// Direct agents bypass HTTP_PROXY env vars — the api-server is reached
// internally over the cluster network, not through the Envoy sidecar.
const directAgent = new HttpAgent({ keepAlive: true });
const directHttpsAgent = new HttpsAgent({ keepAlive: true });

export interface StreamOptions {
  url: string;
  onDispatch: (event: string, data: string) => void;
}

/**
 * Open one SSE connection and dispatch frames until the server closes the
 * stream or the connection errors. Resolves on clean end; rejects on
 * status != 200 or transport error. The api-server's harness port admits
 * agent pods via NetworkPolicy and identifies the caller by source IP — no
 * Bearer header is sent.
 */
export function streamOnce(opts: StreamOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = new URL(opts.url);
    const doRequest = url.protocol === "https:" ? httpsRequest : httpRequest;
    const agent = url.protocol === "https:" ? directHttpsAgent : directAgent;

    const req = doRequest(
      url,
      {
        method: "GET",
        agent,
        headers: {
          Accept: "text/event-stream",
          "Cache-Control": "no-cache",
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          // Drain body so the socket can be reused.
          res.resume();
          reject(new Error(`unexpected status ${res.statusCode}`));
          return;
        }
        process.stderr.write(`[pod-files] connected ${opts.url}\n`);

        let buffer = "";
        let event = "";
        let data = "";

        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          buffer += chunk;
          let nl: number;
          while ((nl = buffer.indexOf("\n")) >= 0) {
            let line = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 1);
            if (line.endsWith("\r")) line = line.slice(0, -1);

            if (line === "") {
              if (event !== "" || data !== "") {
                try {
                  opts.onDispatch(event, data);
                } catch (err) {
                  process.stderr.write(`[pod-files] dispatch failed: ${err}\n`);
                }
              }
              event = "";
              data = "";
              continue;
            }
            if (line.startsWith("event:")) {
              event = line.slice("event:".length).trim();
            } else if (line.startsWith("data:")) {
              const piece = line.slice("data:".length).trim();
              data = data === "" ? piece : data + "\n" + piece;
            }
          }
        });
        res.on("end", resolve);
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

export interface RunOptions extends StreamOptions {
  /** Lower bound on reconnect delay. Default 1s. */
  minBackoffMs?: number;
  /** Upper bound on reconnect delay. Default 30s. */
  maxBackoffMs?: number;
  /** Backoff resets to min once the connection has been alive for this long. */
  healthyUptimeMs?: number;
}

/**
 * Run the SSE loop forever, reconnecting with exponential backoff (jittered)
 * after each disconnect. Returns when never — pod lifetime is the loop's
 * lifetime. The Go sidecar's behaviour, ported.
 */
export async function runSseLoop(opts: RunOptions): Promise<never> {
  const minBackoff = opts.minBackoffMs ?? 1000;
  const maxBackoff = opts.maxBackoffMs ?? 30_000;
  const healthyUptime = opts.healthyUptimeMs ?? 30_000;
  let backoff = minBackoff;

  for (;;) {
    const start = Date.now();
    try {
      await streamOnce(opts);
    } catch (err) {
      process.stderr.write(`[pod-files] stream error: ${err}\n`);
    }
    const uptime = Date.now() - start;
    if (uptime > healthyUptime) backoff = minBackoff;

    const jitter = Math.floor(Math.random() * 200);
    await sleep(backoff + jitter);
    backoff = Math.min(backoff * 2, maxBackoff);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
