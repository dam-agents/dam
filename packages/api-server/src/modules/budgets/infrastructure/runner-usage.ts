import { request } from "node:https";
import { z } from "zod";
import type { K8sClient } from "../../agents/infrastructure/k8s.js";
import { LABEL_OWNER } from "../../agents/infrastructure/labels.js";
import type { RunnerUsage } from "../domain/vm-usage.js";

// UNIT_BOUNDARY_DESCRIPTION: the controller writes one Secret per runner holding the runner's URL, the CA its serving certificate chains to, and a usage capability, which the runner accepts on its usage read alone, and marks it with this label beside the owner's. The api-server reads that Secret rather than the runner's token or TLS Secret, so it can never create, change or delete a machine, nor hold the runner's key.
const USAGE_SECRET_LABEL = "agent-platform.ai/vm-runner-usage";

const READ_TIMEOUT_MS = 2_000;
const CACHE_MS = 10_000;

const runnerUsageSchema = z.object({
  storage: z.object({
    usedBytes: z.number().nonnegative(),
    usableBytes: z.number().nonnegative(),
  }),
  memory: z.object({
    limitMiB: z.number().nonnegative(),
    committedMiB: z.number().nonnegative(),
  }),
  cpu: z
    .object({
      limitMilli: z.number().nonnegative(),
      usedMilli: z.number().nonnegative(),
      throttledPercent: z.number().nonnegative(),
    })
    .optional(),
  machines: z.array(
    z.object({
      id: z.string(),
      state: z.string(),
      usedMiB: z.number().nonnegative().default(0),
      diskGiB: z.number().nonnegative().default(0),
      diskUsedBytes: z.number().nonnegative().default(0),
      cpuMilli: z.number().nonnegative().default(0),
    }),
  ),
});

const cache = new Map<string, { at: number; usage: RunnerUsage | null }>();

// UNIT_BOUNDARY_DESCRIPTION: what the owner's runner says it uses, or null when the owner has no runner, its Secret is not written yet, or the runner cannot be read in time. Every caller treats null as unknown and refuses nothing on it, because the runner refuses a machine it has no room for on its own. One read serves an owner for CACHE_MS, so the home dashboard and a burst of creates cost one runner call.
export async function readRunnerUsage(
  k8s: K8sClient,
  owner: string,
  now: number = Date.now(),
): Promise<RunnerUsage | null> {
  const hit = cache.get(owner);
  if (hit && now - hit.at < CACHE_MS) return hit.usage;
  const usage = await fetchUsage(k8s, owner).catch(() => null);
  cache.set(owner, { at: now, usage });
  return usage;
}

async function fetchUsage(
  k8s: K8sClient,
  owner: string,
): Promise<RunnerUsage | null> {
  const [secret] = await k8s.listSecrets(
    `${USAGE_SECRET_LABEL}=true,${LABEL_OWNER}=${owner}`,
  );
  const field = (key: string) => {
    const value = secret?.data?.[key];
    return value ? Buffer.from(value, "base64").toString("utf8") : "";
  };
  const url = field("url");
  const ca = field("ca.crt");
  const capability = field("capability");
  if (!url || !ca || !capability) return null;
  const body = await getText(`${url}/usage`, capability, ca);
  return parseRunnerUsage(JSON.parse(body), new Date());
}

export function parseRunnerUsage(
  body: unknown,
  observedAt: Date,
): RunnerUsage | null {
  const parsed = runnerUsageSchema.safeParse(body);
  return parsed.success
    ? { ...parsed.data, observedAt: observedAt.toISOString() }
    : null;
}

function getText(url: string, bearer: string, ca: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "GET",
        ca,
        headers: { authorization: `Bearer ${bearer}` },
        timeout: READ_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          res.statusCode === 200
            ? resolve(Buffer.concat(chunks).toString("utf8"))
            : reject(new Error(`runner usage read answered ${res.statusCode}`)),
        );
        res.on("error", reject);
      },
    );
    req.on("timeout", () =>
      req.destroy(new Error("runner usage read timed out")),
    );
    req.on("error", reject);
    req.end();
  });
}
