import * as grpc from "@grpc/grpc-js";
import { formatError } from "../../core/format-error.js";
import { getLogger } from "../../core/logger.js";
import {
  parseSpendMetadata,
  SPEND_METADATA_NAMESPACE,
  type CallRecord,
  type SpendIngest,
} from "../../modules/spend/index.js";
import {
  AccessLogType,
  ResponseFlags_Unauthorized_Reason,
  type AccessLogServiceServer,
  type HTTPAccessLogEntry,
} from "../../proto-gen/accesslog.gen.js";

const PROXY_COST_HEADER = "x-litellm-response-cost";

export interface SpendRecordStreams {
  service: AccessLogServiceServer;
  endAll(): void;
}

export function createSpendRecordStreams(deps: {
  agentFromAuthority(authority: string): string | null;
  ingest: SpendIngest;
}): SpendRecordStreams {
  const open = new Set<() => void>();
  return {
    service: {
      streamAccessLogs(call, callback) {
        const authority = call.getHost();
        const agentId = deps.agentFromAuthority(authority);
        if (!agentId) {
          getLogger().warn({ authority }, "spend.records_refused");
          callback({
            code: grpc.status.PERMISSION_DENIED,
            details: `unable to derive instance from :authority='${authority}'`,
          });
          return;
        }
        let pending = Promise.resolve();
        let ended = false;
        const end = () => {
          if (ended) return;
          ended = true;
          open.delete(end);
          void pending.then(() => callback(null, {}));
        };
        open.add(end);
        call.on("data", (message) => {
          for (const entry of message.httpLogs?.logEntry ?? []) {
            const record = callRecordOf(agentId, entry);
            if (!record) continue;
            pending = pending
              .then(() => deps.ingest.record(record))
              .catch((err: unknown) =>
                getLogger().error(
                  { agentId, callId: record.callId, reason: formatError(err) },
                  "spend.record_failed",
                ),
              );
          }
        });
        call.on("end", end);
        call.on("error", () => {
          ended = true;
          open.delete(end);
        });
      },
    },
    endAll() {
      for (const end of [...open]) end();
    },
  };
}

function callRecordOf(
  agentId: string,
  entry: HTTPAccessLogEntry,
): CallRecord | null {
  const common = entry.commonProperties;
  const spend = parseSpendMetadata(
    common?.metadata?.filterMetadata[SPEND_METADATA_NAMESPACE],
  );
  if (!spend) return null;
  const startedAt = common?.startTime ?? new Date();
  return {
    ...spend,
    agentId,
    status: entry.response?.responseCode || null,
    proxyCost: entry.response?.responseHeaders[PROXY_COST_HEADER] ?? null,
    final: common?.accessLogType !== AccessLogType.DownstreamPeriodic,
    refusedByGate:
      common?.responseFlags?.unauthorizedDetails?.reason ===
      ResponseFlags_Unauthorized_Reason.EXTERNAL_SERVICE,
    startedAt,
    durationMs: common?.duration
      ? common.duration.seconds * 1000 +
        Math.round(common.duration.nanos / 1_000_000)
      : Math.max(0, Date.now() - startedAt.getTime()),
  };
}
