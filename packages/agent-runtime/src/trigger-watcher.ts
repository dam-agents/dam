import {
  watch,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
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

export function startTriggerWatcher(
  options: TriggerWatcherOptions,
): TriggerWatcher {
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

      processTrigger(trigger, filePath, options).finally(() => {
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
    process.stderr.write(
      `[trigger] Invalid trigger file ${filePath}: ${err}\n`,
    );
    try {
      unlinkSync(filePath);
    } catch {}
    return null;
  }
}

async function processTrigger(
  trigger: TriggerPayload,
  filePath: string,
  options: TriggerWatcherOptions,
): Promise<void> {
  process.stderr.write(
    `[trigger] Processing: ${trigger.schedule} (${trigger.timestamp})\n`,
  );

  try {
    if (!options.apiServerUrl) {
      process.stderr.write(
        `[trigger] API_SERVER_URL not set, skipping ${trigger.schedule}\n`,
      );
      return;
    }
    const mcpServers = [...trigger.mcpServers];
    if (config.PLATFORM_MCP_URL) {
      // No Authorization header: harness traffic flows through the paired
      // gateway pod's Envoy and on through the Istio mesh, which conveys
      // the gateway pod's SPIFFE peer principal to the waypoint. The
      // waypoint enforces principal == URL `:id` (ADR-041).
      mcpServers.push({
        type: "http",
        name: "platform-outbound",
        url: config.PLATFORM_MCP_URL,
        headers: [],
      });
    }

    const result = await postTrigger(options.apiServerUrl, options.instanceId, {
      instanceId: options.instanceId,
      schedule: trigger.schedule,
      task: trigger.task,
      type: trigger.type,
      sessionMode: trigger.sessionMode,
      mcpServers,
    });
    process.stderr.write(
      `[trigger] Completed: ${trigger.schedule} session=${result.sessionId} stopReason=${result.stopReason ?? "done"}\n`,
    );
  } catch (err) {
    process.stderr.write(
      `[trigger] Session error for ${trigger.schedule}: ${err}\n`,
    );
  } finally {
    try {
      unlinkSync(filePath);
    } catch {}
  }
}

/** POST to the API server's per-instance trigger endpoint. ADR-041: the
 *  endpoint moved under `/api/instances/:id/internal/trigger` so it falls
 *  under the same waypoint AuthorizationPolicy as MCP and pod-files —
 *  identity is enforced by Istio (principal == URL `:id`), not a header. */
async function postTrigger(
  apiServerUrl: string,
  instanceId: string,
  body: object,
): Promise<{ sessionId: string; stopReason?: string }> {
  const url = new URL(
    `/api/instances/${encodeURIComponent(instanceId)}/internal/trigger`,
    apiServerUrl,
  );
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.text();
  if (!res.ok) {
    throw new Error(`POST trigger failed: ${res.status} ${data}`);
  }
  try {
    return JSON.parse(data);
  } catch {
    throw new Error(`Invalid JSON response: ${data}`);
  }
}
