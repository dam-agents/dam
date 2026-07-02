import {
  createClickhouseClient,
  createClickhouseReader,
} from "./infrastructure/clickhouse-reader.js";
import type { TelemetryReader } from "./services/telemetry-service.js";

/** Startup wiring for the ClickHouse read client (a process-wide connection
 *  pool). Returns `null` when the telemetry backend is not configured — the
 *  request path then wires the disabled service. */
export function composeTelemetryReader(config: {
  clickhouseUrl?: string;
  clickhouseUser: string;
  clickhousePassword: string;
  clickhouseDatabase: string;
}): TelemetryReader | null {
  if (!config.clickhouseUrl) return null;
  return createClickhouseReader(
    createClickhouseClient({
      url: config.clickhouseUrl,
      username: config.clickhouseUser,
      password: config.clickhousePassword,
      database: config.clickhouseDatabase,
    }),
  );
}
