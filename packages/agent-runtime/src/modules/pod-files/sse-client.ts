// SSE client for the api-server's pod-files push channel. Built on Node's
// undici-backed `fetch` so the request honors HTTP_PROXY/NODE_USE_ENV_PROXY
// — the request flows through the paired gateway pod, where Envoy attaches
// the per-instance platform credential before forwarding (issue #108). The
// agent-runtime never holds the credential.

export interface StreamOptions {
  url: string;
  onDispatch: (event: string, data: string) => void;
}

/**
 * Open one SSE connection and dispatch frames until the server closes the
 * stream or the connection errors. Resolves on clean end; rejects on
 * status != 200 or transport error.
 */
export async function streamOnce(opts: StreamOptions): Promise<void> {
  const res = await fetch(opts.url, {
    method: "GET",
    headers: {
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
  if (res.status !== 200) {
    // Drain so the connection can be closed cleanly.
    await res.text().catch(() => {});
    throw new Error(`unexpected status ${res.status}`);
  }
  if (!res.body) {
    throw new Error("response has no body");
  }
  process.stderr.write(`[pod-files] connected ${opts.url}\n`);

  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let event = "";
  let data = "";

  const dispatch = () => {
    if (event === "" && data === "") return;
    try {
      opts.onDispatch(event, data);
    } catch (err) {
      process.stderr.write(`[pod-files] dispatch failed: ${err}\n`);
    }
    event = "";
    data = "";
  };

  const reader = res.body.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      let line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);

      if (line === "") {
        dispatch();
        continue;
      }
      if (line.startsWith("event:")) {
        event = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        const piece = line.slice("data:".length).trim();
        data = data === "" ? piece : data + "\n" + piece;
      }
    }
  }
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
 * after each disconnect. Returns never — pod lifetime is the loop's lifetime.
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
