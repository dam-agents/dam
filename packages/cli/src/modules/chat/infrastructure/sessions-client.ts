import type { SessionView } from "api-server-api";
import { SessionMode } from "api-server-api";
import { err, ok, type Result } from "../../../result.js";

type Fail = { kind: "session-failed"; reason: string };

export function createSessionsClient(deps: { host: string; token: string }) {
  const base = `${deps.host.replace(/\/+$/, "")}/api/trpc`;
  const headers = { authorization: `Bearer ${deps.token}` };

  async function rpc<T>(procedure: string, input: unknown, method: "GET" | "POST" = "GET"): Promise<Result<T, Fail>> {
    try {
      const url = method === "GET"
        ? `${base}/${procedure}?input=${encodeURIComponent(JSON.stringify(input))}`
        : `${base}/${procedure}`;
      const res = await fetch(url, method === "GET"
        ? { headers }
        : { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(input) });
      if (!res.ok) return err({ kind: "session-failed", reason: `server returned ${res.status}` });
      const body = await res.json() as { result?: { data?: T } };
      return ok(body?.result?.data as T);
    } catch (e) {
      return err({ kind: "session-failed", reason: (e as Error).message });
    }
  }

  return {
    list: (instanceId: string) => rpc<readonly SessionView[]>("sessions.list", { instanceId }),
    create: (sessionId: string, instanceId: string) => rpc<void>("sessions.create", { sessionId, instanceId, mode: SessionMode.Terminal }, "POST"),
    setMode: (sessionId: string, instanceId: string, mode: "chat" | "terminal") => rpc<void>("sessions.setMode", { sessionId, instanceId, mode }, "POST"),
  };
}
