import {
  INVOCATION_OUTPUT_STREAMS,
  type InvocationOutput,
  type InvocationOutputLink,
  type InvocationOutputStream,
  type InvocationScriptReports,
  type ScriptReportInput,
} from "api-server-api";

import { getLogger } from "../../../core/logger.js";
import {
  heldStreams,
  OUTPUT_RETENTION_MS,
  outputKey,
} from "../domain/script-output.js";
import type {
  InvocationRow,
  InvocationsRepository,
} from "../infrastructure/invocations-repository.js";
import type { TargetReaper } from "./target-reaper.js";

export interface OutputBlobStore {
  createUploadUrl(key: string): Promise<{ url: string } | null>;
  stat(key: string): Promise<{ sizeBytes: number } | null>;
  createAgentDownloadUrl(
    key: string,
    filename: string,
  ): Promise<{ url: string } | null>;
  delete(key: string): Promise<void>;
}

export interface ScriptOutputs extends InvocationScriptReports {
  link(
    invocationId: string,
    driverAgentId: string,
    stream: InvocationOutputStream,
  ): Promise<InvocationOutputLink | null>;
  ack(
    invocationId: string,
    driverAgentId: string,
    stream: InvocationOutputStream,
  ): Promise<boolean>;
  purgeExpired(limit: number): Promise<number>;
  purgeRoot(rootDriverId: string): Promise<void>;
}

const NO_STORE_REASON =
  "no object store is configured on this deployment, so a script's output has nowhere to go";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the life of a script sub-agent's output. The
 * target uploads stdout and stderr to keys only the server builds, then
 * reports; the report is checked against what the store holds, so the size the
 * driver is told is the size it will download. A driver acks each stream once
 * it holds a verified copy, which deletes the blob; what nobody collects goes
 * after OUTPUT_RETENTION_MS, and all of it goes with the root driver. The keys
 * are fixed per invocation, so a cleanup deletes both streams whatever the
 * record says, and an upload no report recorded never outlives its root.
 */
export function createScriptOutputs(deps: {
  repo: InvocationsRepository;
  store: OutputBlobStore;
  reaper: TargetReaper;
  now?: () => Date;
}): ScriptOutputs {
  const now = deps.now ?? (() => new Date());

  async function runningScript(
    agentId: string,
  ): Promise<
    | { row: InvocationRow; refused?: undefined }
    | { row: InvocationRow | null; refused: string }
  > {
    const row = await deps.repo.get(agentId);
    if (!row || row.script === null)
      return {
        row: null,
        refused: "this agent is not running a script for a driver",
      };
    if (row.status !== "running")
      return {
        row,
        refused: `the script's invocation is already ${row.status}`,
      };
    return { row };
  }

  async function deleteStreams(
    row: InvocationRow,
    streams: readonly InvocationOutputStream[],
  ): Promise<void> {
    for (const stream of streams) {
      await deps.store.delete(outputKey(row, stream));
    }
  }

  async function verified(
    row: InvocationRow,
    reported: InvocationOutput,
  ): Promise<{ output: InvocationOutput; missing: InvocationOutputStream[] }> {
    const output: InvocationOutput = {};
    const missing: InvocationOutputStream[] = [];
    for (const stream of heldStreams(reported)) {
      const blob = reported[stream]!;
      const stat = await deps.store.stat(outputKey(row, stream));
      if (stat && stat.sizeBytes === blob.sizeBytes) output[stream] = blob;
      else missing.push(stream);
    }
    return { output, missing };
  }

  return {
    async uploads(agentId) {
      const { row, refused } = await runningScript(agentId);
      if (refused !== undefined) return { outcome: "refused", reason: refused };
      const [stdout, stderr] = await Promise.all([
        deps.store.createUploadUrl(outputKey(row, "stdout")),
        deps.store.createUploadUrl(outputKey(row, "stderr")),
      ]);
      if (!stdout || !stderr)
        return { outcome: "refused", reason: NO_STORE_REASON };
      return { outcome: "upload", stdout: stdout.url, stderr: stderr.url };
    },

    async report(agentId, input: ScriptReportInput) {
      const { row, refused } = await runningScript(agentId);
      if (refused !== undefined) {
        if (row) {
          const recorded = heldStreams(row.output);
          await deleteStreams(
            row,
            heldStreams(input.output).filter((s) => !recorded.includes(s)),
          );
        }
        return { outcome: "refused", reason: refused };
      }
      const running = row;
      const { output, missing } = await verified(running, input.output);
      const outputExpiresAt =
        heldStreams(output).length > 0
          ? new Date(now().getTime() + OUTPUT_RETENTION_MS)
          : null;
      const failure =
        missing.length > 0
          ? `the script's ${missing.join(" and ")} did not reach the object store`
          : input.failure;
      const recorded =
        failure === undefined && input.exitCode === 0
          ? await deps.repo.finishScript(running.id, {
              status: "done",
              exitCode: 0,
              output,
              outputExpiresAt,
            })
          : await deps.repo.finishScript(running.id, {
              status: "failed",
              exitCode: input.exitCode,
              errorReason: failure ?? `script exited ${input.exitCode}`,
              output,
              outputExpiresAt,
            });
      if (!recorded) {
        return {
          outcome: "refused",
          reason: "the script's invocation ended meanwhile",
        };
      }
      void deps.reaper.reap(running, { capture: false });
      return { outcome: "recorded" };
    },

    async link(invocationId, driverAgentId, stream) {
      const row = await deps.repo.get(invocationId);
      if (!row || row.driverAgentId !== driverAgentId) return null;
      const blob = row.output?.[stream];
      if (!blob) return null;
      const signed = await deps.store.createAgentDownloadUrl(
        outputKey(row, stream),
        `${row.id}.${stream}`,
      );
      return signed ? { ...blob, url: signed.url } : null;
    },

    async ack(invocationId, driverAgentId, stream) {
      const row = await deps.repo.get(invocationId);
      if (!row || row.driverAgentId !== driverAgentId) return false;
      if (!row.output?.[stream]) return true;
      await deps.store.delete(outputKey(row, stream));
      await deps.repo.dropOutputStream(row.id, stream);
      return true;
    },

    async purgeExpired(limit) {
      const rows = await deps.repo.listExpiredOutputs(now(), limit);
      for (const row of rows) {
        try {
          await deleteStreams(row, INVOCATION_OUTPUT_STREAMS);
          await deps.repo.clearOutput(row.id);
        } catch (err) {
          getLogger().warn(
            { invocationId: row.id, err },
            "invocations: an expired script output could not be deleted",
          );
        }
      }
      return rows.length;
    },

    async purgeRoot(rootDriverId) {
      for (const row of await deps.repo.listScriptsByRoot(rootDriverId)) {
        await deleteStreams(row, INVOCATION_OUTPUT_STREAMS);
      }
    },
  };
}
