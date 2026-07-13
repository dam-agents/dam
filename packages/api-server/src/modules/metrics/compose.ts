import {
  createClickhouseClient,
  createClickhouseReader,
} from "./infrastructure/clickhouse-reader.js";
import type { MetricsReader } from "./services/metrics-service.js";

/** Startup wiring for the ClickHouse read client (a process-wide connection
 *  pool). Returns `null` when the metrics backend is not configured — the
 *  request path then wires the disabled service. */
export function composeMetricsReader(config: {
  clickhouseUrl?: string;
  clickhouseUser: string;
  clickhousePassword: string;
  clickhouseDatabase: string;
}): MetricsReader | null {
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
