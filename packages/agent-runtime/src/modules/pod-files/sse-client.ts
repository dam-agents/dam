export interface StreamOptions {
  url: string;
  onDispatch: (event: string, data: string) => void;
  signal?: AbortSignal;
}

/**
 * Open one SSE connection and dispatch frames until the server closes the
 * stream or the connection errors. Resolves on clean end; rejects on
 * status != 200 or transport error. The connection goes through the
 * paired gateway pod's Envoy (HTTP_PROXY honored via undici because
 * NODE_USE_ENV_PROXY=1 is set on the agent pod), and Envoy stamps the
 * trusted `x-platform-instance` header that the api-server identifies
 * the caller from. No client-side auth header is sent.
 */
export async function streamOnce(opts: StreamOptions): Promise<void> {
  const res = await fetch(opts.url, {
    method: "GET",
    headers: {
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
    },
    signal: opts.signal,
  });
  if (res.status !== 200) {
    // Drain so the connection can be reused.
    await res.body?.cancel();
    throw new Error(`unexpected status ${res.status}`);
  }
  if (!res.body) throw new Error("response had no body");
  process.stderr.write(`[pod-files] connected ${opts.url}\n`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let event = "";
  let data = "";

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
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
    }
  } finally {
    reader.releaseLock();
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
 * after each disconnect. Returns when never — pod lifetime is the loop's
 * lifetime.
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
