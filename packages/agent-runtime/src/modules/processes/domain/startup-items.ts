import type { ProcessRow, StartupItem } from "agent-runtime-api";

export interface StartupItemConfig {
  id: string;
  command: string;
  disabled: boolean;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Joins the configured Startup Items with the rows
 * the scan found running for them, so the panel lists every item, disabled
 * and exited ones too, and whether it runs. Its output is the item's log,
 * which outlives every run.
 */
export function startupItemsFrom(
  configs: StartupItemConfig[],
  running: ProcessRow[],
  logPath: (id: string) => string,
  rowItem: (row: ProcessRow) => string | null,
): StartupItem[] {
  const runningIds = new Set<string>();
  for (const row of running) {
    const id = rowItem(row);
    if (id !== null) runningIds.add(id);
  }
  return configs.map((config) => ({
    id: config.id,
    command: config.command,
    disabled: config.disabled,
    running: runningIds.has(config.id),
    outputPath: logPath(config.id),
  }));
}
