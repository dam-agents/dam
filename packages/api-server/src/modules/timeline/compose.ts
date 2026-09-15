import { createClickhouseClient } from "../metrics/infrastructure/clickhouse-reader.js";
import { createClickhouseTimelineReader } from "./infrastructure/clickhouse-timeline-reader.js";
import type { TimelineReader } from "./services/timeline-service.js";

export function composeTimelineReader(config: {
  clickhouseUrl?: string;
  clickhouseUser: string;
  clickhousePassword: string;
  clickhouseDatabase: string;
}): TimelineReader | null {
  if (!config.clickhouseUrl) return null;
  return createClickhouseTimelineReader(
    createClickhouseClient({
      url: config.clickhouseUrl,
      username: config.clickhouseUser,
      password: config.clickhousePassword,
      database: config.clickhouseDatabase,
    }),
  );
}
