import { join } from "node:path";
import { z } from "zod";
import { openJsonFile } from "../../../core/document-store.js";

const mcpEntryStateSchema = z.object({
  installed: z.array(z.string()).catch([]).default([]),
});

export type McpEntryState = z.infer<typeof mcpEntryStateSchema>;

export interface McpEntryStateStore {
  getInstalled(): string[];
  setInstalled(names: string[]): void;
}

export function createMcpEntryStateStore(stateDir: string): McpEntryStateStore {
  const store = openJsonFile(join(stateDir, "mcp-entry-state.json"), {
    schema: mcpEntryStateSchema,
    initial: () => ({ installed: [] }),
  });

  return {
    getInstalled() {
      return store.read().installed;
    },
    setInstalled(names) {
      store.write({ installed: [...names].sort() });
    },
  };
}
