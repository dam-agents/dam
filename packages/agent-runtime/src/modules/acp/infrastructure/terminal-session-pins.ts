import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type PlatformSessionOf = (
  harnessSessionId: string,
) => string | undefined;

/**
 * UNIT_BOUNDARY_DESCRIPTION: the pins a harness writes when it mints its own id
 * for a terminal Session's conversation — one file per terminal Session, named
 * by the Session id and holding the harness's id (runtime-manifest
 * `terminalSessionPins`). Read once per Session list rather than watched: a pin
 * lands on the conversation's first turn, which is also what invalidates the
 * list. A missing directory or an unreadable pin maps nothing.
 */
export function readTerminalSessionPins(dir: string): PlatformSessionOf {
  const byHarnessId = new Map<string, string>();
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return () => undefined;
  }
  for (const platformSessionId of names) {
    try {
      const harnessSessionId = readFileSync(
        join(dir, platformSessionId),
        "utf8",
      ).trim();
      if (harnessSessionId)
        byHarnessId.set(harnessSessionId, platformSessionId);
    } catch {
      continue;
    }
  }
  return (harnessSessionId) => byHarnessId.get(harnessSessionId);
}
