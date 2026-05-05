import { watch, mkdirSync, readdirSync, readFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Agent, request } from "node:http";
import { Agent as HttpsAgent, request as requestHttps } from "node:https";

// Explicit agents bypass HTTP_PROXY env vars (agent pods route external
// traffic through OneCLI, but internal cluster calls must go direct).
const directAgent = new Agent();
const directHttpsAgent = new HttpsAgent();
import { z } from "zod/v4";
import { config } from "./modules/config.js";

const TriggerFile = z.object({
  schedule: z.string(),
  timestamp: z.string(),
  task: z.string(),
  // Schedule type — the controller passes through whichever type the
  // schedule spec carries. "rrule" is the new format introduced with
  // ADR-031; "cron" is the legacy path.
  type: z.enum(["cron", "rrule"]).optional(),
  sessionMode: z.enum(["continuous", "fresh"]).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  mcpServers: z.array(z.unknown()).default([]),
});

type TriggerPayload = z.infer<typeof TriggerFile>;

interface TriggerWatcherOptions {
  triggersDir: string;
  apiServerUrl: string;
  instanceId: string;
}

export interface TriggerWatcher {
  activeCount(): number;
}

export function startTriggerWatcher(options: TriggerWatcherOptions): TriggerWatcher {
  const { triggersDir } = options;
  const inflightSchedules = new Set<string>();
  const processingFiles = new Set<string>();

  mkdirSync(triggersDir, { recursive: true });

  function scanAndProcess() {
    let files: string[];
    try {
      files = readdirSync(triggersDir).filter((f) => f.endsWith(".json"));
    } catch {
      return;
    }

    for (const file of files) {
      if (processingFiles.has(file)) continue;

      const filePath = join(triggersDir, file);
      const trigger = peekTrigger(filePath);
      if (!trigger) continue;

      // Per-schedule serialization: skip if this schedule is already running
      if (inflightSchedules.has(trigger.schedule)) continue;

      processingFiles.add(file);
      inflightSchedules.add(trigger.schedule);

      processTrigger(trigger, filePath, options)
        .finally(() => {
          processingFiles.delete(file);
          inflightSchedules.delete(trigger.schedule);
          scanAndProcess();
        });
    }
  }

  scanAndProcess();
  watch(triggersDir, () => scanAndProcess());

  process.stderr.write(`[trigger] Watching ${triggersDir}\n`);

  return { activeCount: () => processingFiles.size };
}

function peekTrigger(filePath: string): TriggerPayload | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf8");
    return TriggerFile.parse(JSON.parse(raw));
  } catch (err) {
    process.stderr.write(`[trigger] Invalid trigger file ${filePath}: ${err}\n`);
    try { unlinkSync(filePath); } catch {}
    return null;
  }
}

async function processTrigger(
  trigger: TriggerPayload,
  filePath: string,
  options: TriggerWatcherOptions,
): Promise<void> {
  process.stderr.write(`[trigger] Processing: ${trigger.schedule} (${trigger.timestamp})\n`);

  try {
    if (!options.apiServerUrl) {
      process.stderr.write(`[trigger] API_SERVER_URL not set, skipping ${trigger.schedule}\n`);
      return;
    }
    const mcpServers = [...trigger.mcpServers];
    if (config.HUMR_MCP_URL) {
      // No Authorization header: the api-server's harness port admits agent
      // pods via NetworkPolicy and identifies the caller by source IP.
      mcpServers.push({ type: "http", name: "humr-outbound", url: config.HUMR_MCP_URL, headers: [] });
    }

    const result = await postTrigger(options.apiServerUrl, {
      instanceId: options.instanceId,
      schedule: trigger.schedule,
      task: trigger.task,
      type: trigger.type,
      sessionMode: trigger.sessionMode,
      mcpServers,
    });
    process.stderr.write(`[trigger] Completed: ${trigger.schedule} session=${result.sessionId} stopReason=${result.stopReason ?? "done"}\n`);
  } catch (err) {
    process.stderr.write(`[trigger] Session error for ${trigger.schedule}: ${err}\n`);
  } finally {
    try { unlinkSync(filePath); } catch {}
  }
}

/** POST to the API server's /internal/trigger endpoint using node:http (bypasses HTTP_PROXY). */
function postTrigger(
  apiServerUrl: string,
  body: object,
): Promise<{ sessionId: string; stopReason?: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL("/internal/trigger", apiServerUrl);
    const payload = JSON.stringify(body);
    const doRequest = url.protocol === "https:" ? requestHttps : request;

    const req = doRequest(url, {
      method: "POST",
      agent: url.protocol === "https:" ? directHttpsAgent : directAgent,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`Invalid JSON response: ${data}`));
          }
        } else {
          reject(new Error(`POST /internal/trigger failed: ${res.statusCode} ${data}`));
        }
      });
    });

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}
