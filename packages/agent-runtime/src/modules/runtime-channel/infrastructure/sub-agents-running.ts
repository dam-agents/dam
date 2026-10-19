const PROBE_TIMEOUT_MS = 10_000;

/**
 * UNIT_BOUNDARY_DESCRIPTION: Whether any of a session's own sub-agents still
 * runs, asked of the api-server through the same status endpoint the Driver
 * tools read. A sub-agent whose status cannot be read counts as running, so a
 * failed probe leaves the run to its deadline rather than failing a run whose
 * sub-agent may still finish.
 */
export function createSubAgentsRunning(deps: {
  apiServerUrl: string;
  agentId: string;
  fetchImpl?: typeof globalThis.fetch;
  log: (msg: string) => void;
}): (ids: readonly string[]) => Promise<boolean> {
  const doFetch = deps.fetchImpl ?? globalThis.fetch;
  const running = async (id: string): Promise<boolean> => {
    const url = new URL(
      `/api/agents/${encodeURIComponent(deps.agentId)}/invocations/${encodeURIComponent(id)}`,
      deps.apiServerUrl,
    );
    try {
      const res = await doFetch(url, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (res.status === 404) return false;
      if (!res.ok) throw new Error(`status ${res.status}`);
      const { status } = (await res.json()) as { status?: unknown };
      return status === "running";
    } catch (err) {
      deps.log(
        `[invocation] could not read sub-agent ${id}: ${(err as Error).message}`,
      );
      return true;
    }
  };
  return async (ids) => (await Promise.all(ids.map(running))).some(Boolean);
}
