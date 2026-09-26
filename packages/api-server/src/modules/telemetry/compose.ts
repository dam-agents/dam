import { createClient } from "@clickhouse/client";
import { createClickhouseTelemetryReader } from "./infrastructure/clickhouse-telemetry-reader.js";
import type { TelemetryReader } from "./services/telemetry-service.js";

export function composeTelemetryReader(config: {
  clickhouseUrl?: string;
  clickhouseUser: string;
  clickhousePassword: string;
  clickhouseDatabase: string;
}): TelemetryReader | null {
  if (!config.clickhouseUrl) return null;
  return createClickhouseTelemetryReader(
    createClient({
      url: config.clickhouseUrl,
      username: config.clickhouseUser,
      password: config.clickhousePassword,
      database: config.clickhouseDatabase,
    }),
  );
}
