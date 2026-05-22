import type {
  RuntimeChannelHelloInput,
  RuntimeChannelHelloResult,
} from "api-server-api";

/** HTTP client the agent uses to call back into the harness API server.
 *  Two routes only — hello (boot/reconnect catch-up) and ack (signal
 *  delete-on-success). The URL is built by the controller and injected
 *  via env at pod spec time; the agent does not know the harness API's
 *  pod IP. */
export interface ServerHelloAckClient {
  hello(input: RuntimeChannelHelloInput): Promise<RuntimeChannelHelloResult>;
  ack(signalId: string): Promise<void>;
}

export interface ServerHelloAckClientOptions {
  /** Harness API base URL for THIS agent. Already shaped as
   *  `http://<harness-svc>/api/agents/<agent-id>`. The constructor
   *  appends `/runtime/v1/{hello,ack}`. */
  baseUrl: string;
  /** Per-call timeout in ms. Server work is bounded (read outbox, build
   *  state) but a tight bound keeps the boot path from hanging. */
  timeoutMs?: number;
}

export function createServerHelloAckClient(
  opts: ServerHelloAckClientOptions,
): ServerHelloAckClient {
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const base = opts.baseUrl.replace(/\/$/, "");

  async function call<T>(path: string, body: unknown): Promise<T> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`${path} ${res.status}: ${text}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(t);
    }
  }

  return {
    hello: (input) =>
      call<RuntimeChannelHelloResult>("/runtime/v1/hello", input),
    ack: async (signalId) => {
      await call<{ ok: true }>("/runtime/v1/ack", { signalId });
    },
  };
}
