import { applyFile } from "./apply.js";
import { runSseLoop } from "./sse-client.js";
import { FileSpecSchema, type FileSpec } from "api-server-api";

export interface PodFilesSyncOptions {
  /** SSE endpoint built by the reconciler:
   *  `${HARNESS_SERVER_URL}/api/instances/<instance>/pod-files/events`. */
  url: string;
  /** Agent container HOME — paths in incoming FileSpecs must resolve under
   *  this prefix or the write is refused (defense-in-depth). */
  agentHome: string;
}

/**
 * Start the pod-files SSE sync loop. Mirrors `startTriggerWatcher`'s
 * shape: synchronous startup, async loop running for the rest of the
 * process's lifetime, errors logged but never crash the runtime.
 *
 * The loop dispatches "snapshot" (sent on connect) and "upsert" (sent on
 * state change) events to applyFile. Other event types are ignored.
 */
export function startPodFilesSync(opts: PodFilesSyncOptions): void {
  process.stderr.write(`[pod-files] starting (home=${opts.agentHome})\n`);
  void runSseLoop({
    url: opts.url,
    onDispatch: (event, data) => dispatch(event, data, opts.agentHome),
  });
}

/**
 * Exported only for unit tests — exercises the JSON validation and the
 * apply loop without going through HTTP.
 */
export function dispatch(event: string, data: string, agentHome: string): void {
  if (event !== "snapshot" && event !== "upsert") return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch (err) {
    process.stderr.write(`[pod-files] bad ${event} JSON: ${err}\n`);
    return;
  }
  const files = extractFiles(parsed);
  if (files === null) {
    process.stderr.write(
      `[pod-files] ${event} payload missing or malformed "files" array; ignored\n`,
    );
    return;
  }

  for (const file of files) {
    try {
      applyFile(file, agentHome);
    } catch (err) {
      process.stderr.write(
        `[pod-files] apply failed for ${file.path}: ${err}\n`,
      );
    }
  }
}

/**
 * Per-file validation: a single bad row is dropped and logged; the rest
 * of the payload still applies. Returns `null` only when the envelope
 * itself is unusable (not an object, no `files` array).
 */
function extractFiles(parsed: unknown): FileSpec[] | null {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const files = (parsed as { files?: unknown }).files;
  if (!Array.isArray(files)) return null;
  const out: FileSpec[] = [];
  for (const f of files) {
    const result = FileSpecSchema.safeParse(f);
    if (result.success) {
      out.push(result.data);
    } else {
      process.stderr.write(
        `[pod-files] skipping malformed file entry: ${JSON.stringify(f)} (${result.error.message})\n`,
      );
    }
  }
  return out;
}
