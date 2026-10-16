import { createClient } from "@clickhouse/client";
import {
  createClickhouseReader,
  MAX_EXECUTION_SECONDS,
} from "./infrastructure/clickhouse-reader.js";
import type { MetricsReader } from "./services/metrics-service.js";

export function composeMetricsReader(config: {
  clickhouseUrl?: string;
  clickhouseUser: string;
  clickhousePassword: string;
  clickhouseDatabase: string;
}): MetricsReader | null {
  if (!config.clickhouseUrl) return null;
  return createClickhouseReader(
    createClient({
      url: config.clickhouseUrl,
      username: config.clickhouseUser,
      password: config.clickhousePassword,
      database: config.clickhouseDatabase,
      request_timeout: (MAX_EXECUTION_SECONDS + 5) * 1000,
    }),
  );
}
