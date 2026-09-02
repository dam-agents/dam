import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import type { KbPublishService, KbPublishSyncInput } from "agent-runtime-api";
import {
  kbPublishCapsSchema,
  type KbPublishFailure,
} from "agent-runtime-api/kb-snapshot";

import { createFilesWatcher, type WatchHandle } from "../files-watch.js";
import type { HarnessClient } from "../runtime-channel/harness-client.js";
import { executeWork } from "./executor.js";
import { planShare } from "./walker.js";

const DEBOUNCE_MS = 3 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const BOOT_FLUSH_DELAY_MS = 10 * 1000;
const STATE_FILE = ".kb-publish.json";

const stateSchema = z.object({
  roots: z.array(z.string()).nullable(),
  caps: kbPublishCapsSchema.nullable(),
  dirty: z.boolean(),
});
type FlusherState = z.infer<typeof stateSchema>;

export interface KbPublishRuntime {
  service: KbPublishService;
  isBusy: () => boolean;
}

function toWireFailure(failure: KbPublishFailure): {
  code: string;
  root?: string;
  detail?: string;
} {
  return {
    code: failure.code,
    ...("root" in failure ? { root: failure.root } : {}),
    ...("detail" in failure ? { detail: failure.detail } : {}),
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the pod-side publish flusher — owns the share's
 * change detection end to end: a recursive watch on the share roots sets a
 * PVC-persisted dirty marker and re-arms a quiet-period timer; when the timer
 * fires, the pod plans locally and asks the api-server to publish (work order
 * + presigned uploads + completion report). The server stays the authority
 * for keys, verification, and the manifest; this module only decides WHEN.
 * A pending flush holds the pod's idle flag via isBusy (scheduled or running
 * work only — a share stuck in a recorded failure never blocks hibernation),
 * and the persisted marker makes a force-killed pod flush on its next boot.
 */
export function composeKbPublish(opts: {
  workDir: string;
  homeDir: string;
  harness: HarnessClient;
  log: (msg: string) => void;
}): KbPublishRuntime {
  const statePath = join(opts.homeDir, STATE_FILE);
  const watcher = createFilesWatcher(opts.workDir);
  let state: FlusherState = { roots: null, caps: null, dirty: false };
  let configured = false;
  let watchHandles: WatchHandle[] = [];
  let timer: NodeJS.Timeout | undefined;
  let flushing = false;
  let rearmDelayMs: number | undefined;
  let generation = 0;

  async function persist(): Promise<void> {
    try {
      await writeFile(statePath, JSON.stringify(state));
    } catch (e) {
      opts.log(`state write failed: ${e}`);
    }
  }

  function stopWatching(): void {
    for (const handle of watchHandles) handle.close();
    watchHandles = [];
  }

  function startWatching(): void {
    stopWatching();
    if (!state.roots) return;
    watchHandles = state.roots.map((root) =>
      watcher.watchTree(root, onChanged),
    );
  }

  function arm(delayMs: number): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void runFlush(delayMs);
    }, delayMs);
    timer.unref?.();
  }

  function disarm(): void {
    if (timer) clearTimeout(timer);
    timer = undefined;
  }

  function onChanged(): void {
    generation += 1;
    if (!state.dirty) {
      state.dirty = true;
      void persist();
    }
    arm(DEBOUNCE_MS);
  }

  async function settle(generationAtPlan: number): Promise<void> {
    if (generation === generationAtPlan) {
      state.dirty = false;
      await persist();
    } else {
      arm(DEBOUNCE_MS);
    }
  }

  async function runFlush(requestedDelayMs = DEBOUNCE_MS): Promise<void> {
    if (flushing) {
      rearmDelayMs = Math.min(rearmDelayMs ?? Infinity, requestedDelayMs);
      return;
    }
    if (!state.roots || !state.caps || !state.dirty) return;
    flushing = true;
    try {
      const generationAtPlan = generation;
      const planned = await planShare({
        workDir: opts.workDir,
        roots: state.roots,
        caps: state.caps,
      });
      if (!planned.ok) {
        await opts.harness.kbPublish.request.mutate({
          kind: "failure",
          failure: toWireFailure(planned.error),
        });
        return;
      }
      const result = await opts.harness.kbPublish.request.mutate({
        kind: "plan",
        files: planned.value.files,
      });
      switch (result.outcome) {
        case "not-shared":
          if (generation !== generationAtPlan) {
            arm(DEBOUNCE_MS);
            return;
          }
          state = { ...state, roots: null, dirty: false };
          stopWatching();
          disarm();
          rearmDelayMs = undefined;
          await persist();
          return;
        case "busy":
          arm(RETRY_MS);
          return;
        case "rejected":
          return;
        case "up-to-date":
          await settle(generationAtPlan);
          return;
        case "work": {
          const executed = await executeWork({
            workDir: opts.workDir,
            work: result.order,
            log: opts.log,
          });
          if (!executed.ok) {
            opts.log(`upload failed: ${executed.error.code}`);
            await opts.harness.kbPublish.complete.mutate({
              ticket: result.order.ticket,
              report: { aborted: true, segments: [], drifted: [] },
            });
            arm(RETRY_MS);
            return;
          }
          const completion = await opts.harness.kbPublish.complete.mutate({
            ticket: result.order.ticket,
            report: executed.value,
          });
          switch (completion.outcome) {
            case "committed":
              await settle(generationAtPlan);
              return;
            case "retry":
              arm(RETRY_MS);
              return;
            case "failed":
              return;
          }
        }
      }
    } catch (e) {
      opts.log(`flush failed: ${e instanceof Error ? e.message : e}`);
      arm(RETRY_MS);
    } finally {
      flushing = false;
      if (rearmDelayMs !== undefined) {
        arm(rearmDelayMs);
        rearmDelayMs = undefined;
      }
    }
  }

  async function sync(input: KbPublishSyncInput): Promise<{ ok: true }> {
    configured = true;
    const rootsChanged =
      JSON.stringify(input.roots) !== JSON.stringify(state.roots);
    if (input.roots === null) {
      state = { roots: null, caps: input.caps, dirty: false };
      stopWatching();
      disarm();
      rearmDelayMs = undefined;
      await persist();
      return { ok: true };
    }
    if (rootsChanged || input.flush) generation += 1;
    state = {
      roots: input.roots,
      caps: input.caps,
      dirty: state.dirty || input.flush || rootsChanged,
    };
    await persist();
    if (rootsChanged) startWatching();
    if (input.flush) {
      disarm();
      void runFlush(0);
    } else if (rootsChanged) arm(DEBOUNCE_MS);
    return { ok: true };
  }

  void (async () => {
    try {
      const raw = await readFile(statePath, "utf8");
      const parsed = stateSchema.safeParse(JSON.parse(raw));
      if (parsed.success && !configured) state = parsed.data;
    } catch {
      return;
    }
    if (configured) return;
    if (state.roots) startWatching();
    if (state.dirty && state.roots && state.caps) arm(BOOT_FLUSH_DELAY_MS);
  })();

  return {
    isBusy: () => flushing || timer !== undefined,
    service: { sync },
  };
}
