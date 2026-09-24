import { z } from "zod";
import { SESSION_REF_HEADER, PLATFORM_MCP_ENTRY_NAME } from "agent-runtime-api";
import type { DocumentStoreBackend } from "../../../core/document-store.js";

const entrySchema = z
  .object({
    url: z.string().min(1),
    headers: z.record(z.string(), z.string()).optional(),
  })
  .nullable()
  .catch(null);

export type PlatformMcpEntry = NonNullable<z.infer<typeof entrySchema>>;

export interface PlatformMcpEntryStore {
  set(entry: PlatformMcpEntry | null): void;
  sessionServers(ref: string): unknown[];
}

export function createPlatformMcpEntryStore(
  backend: DocumentStoreBackend,
): PlatformMcpEntryStore {
  const store = backend.open("platform-mcp-entry", {
    schema: entrySchema,
    initial: () => null,
  });
  return {
    set(entry) {
      store.write(entry);
    },
    sessionServers(ref) {
      const entry = store.read();
      if (!entry) return [];
      const headers = Object.entries(entry.headers ?? {}).map(
        ([name, value]) => ({ name, value }),
      );
      return [
        {
          type: "http",
          name: PLATFORM_MCP_ENTRY_NAME,
          url: entry.url,
          headers: [...headers, { name: SESSION_REF_HEADER, value: ref }],
        },
      ];
    },
  };
}
