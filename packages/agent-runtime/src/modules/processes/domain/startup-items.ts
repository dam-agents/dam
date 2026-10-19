import type { ProcessRow, StartupItem } from "agent-runtime-api";

export interface StartupItemConfig {
  id: string;
  command: string;
  disabled: boolean;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Joins the configured Startup Items with the rows
 * the scan found running for them, so the panel lists every item, disabled
 * and exited ones too, with the row to act on when it runs. Its output is the
 * item's log, which outlives every run.
 */
export function startupItemsFrom(
  configs: StartupItemConfig[],
  running: ProcessRow[],
  logPath: (id: string) => string,
  rowItem: (row: ProcessRow) => string | null,
): StartupItem[] {
  const rows = new Map<string, ProcessRow>();
  for (const row of running) {
    const id = rowItem(row);
    if (id !== null) rows.set(id, row);
  }
  return configs.map((config) => {
    const row = rows.get(config.id);
    return {
      id: config.id,
      command: config.command,
      disabled: config.disabled,
      running: row !== undefined,
      rowKey: row?.key ?? null,
      outputPath: logPath(config.id),
    };
  });
}
