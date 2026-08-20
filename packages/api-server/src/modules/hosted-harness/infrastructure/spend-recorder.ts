import type { ClickHouseClient } from "@clickhouse/client";

export interface SpendRecord {
  agentId: string;
  agentName: string;
  sessionId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  durationMs: number;
}

export type SpendRecorder = (record: SpendRecord) => void;

export function createSpendRecorder(
  client: ClickHouseClient,
  log: (msg: string) => void,
): SpendRecorder {
  return (record) => {
    void client
      .insert({
        table: "otel_logs",
        format: "JSONEachRow",
        values: [
          {
            Timestamp: new Date().toISOString(),
            Body: "claude_code.api_request",
            SeverityText: "INFO",
            ResourceAttributes: {
              "platform.agent.id": record.agentId,
              "platform.agent.name": record.agentName,
              "service.name": "hosted-harness",
            },
            LogAttributes: {
              model: record.model,
              "session.id": record.sessionId,
              input_tokens: String(record.inputTokens),
              output_tokens: String(record.outputTokens),
              cache_read_tokens: String(record.cacheReadTokens),
              cache_creation_tokens: String(record.cacheCreationTokens),
              cost_usd_micros: "0",
              duration_ms: String(record.durationMs),
            },
          },
        ],
      })
      .catch((err) => {
        log(
          `[hosted-spend] insert failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  };
}
