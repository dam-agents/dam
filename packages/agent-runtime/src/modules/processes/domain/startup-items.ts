import type { ProcessRow, StartupItem } from "agent-runtime-api";

export interface StartupItemConfig {
  id: string;
  command: string;
  disabled: boolean;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Joins the configured Startup Items with the rows
 * the scan found running for them, so the panel lists every item, disabled
 * and exited ones too, and whether it runs. A row that runs as an item no
 * entry names any more — its entry removed while a stop failed, or edited
 * out of the file — is listed too, as not listed, so nothing that runs is
 * hidden from the user. Its output is the item's log, which outlives every
 * run.
 */
export function startupItemsFrom(
  configs: StartupItemConfig[],
  running: ProcessRow[],
  logPath: (id: string) => string,
  rowItem: (row: ProcessRow) => string | null,
): StartupItem[] {
  const runningRows = new Map<string, ProcessRow>();
  for (const row of running) {
    const id = rowItem(row);
    if (id !== null) runningRows.set(id, row);
  }
  const configured: StartupItem[] = configs.map((config) => ({
    id: config.id,
    command: config.command,
    disabled: config.disabled,
    running: runningRows.has(config.id),
    listed: true,
    outputPath: logPath(config.id),
  }));
  const known = new Set(configs.map((config) => config.id));
  const unlisted: StartupItem[] = [...runningRows]
    .filter(([id]) => !known.has(id))
    .map(([id, row]) => ({
      id,
      command: row.command,
      disabled: false,
      running: true,
      listed: false,
      outputPath: logPath(id),
    }));
  return [...configured, ...unlisted];
}
