import open from "open";
import { err, ok, type Result } from "../../../result.js";
import type { BrowserOpenError } from "../domain/errors.js";

export interface BrowserOpener {
  /** Best-effort open the given URL in the user's default browser. The
   *  Result reflects whether the spawn succeeded — NOT whether the user
   *  actually authorized. The device flow's polling owns the
   *  user-action wait. */
  open(url: string): Promise<Result<void, BrowserOpenError>>;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function createBrowserOpener(): BrowserOpener {
  return {
    async open(url) {
      try {
        await open(url);
        return ok(undefined);
      } catch (e) {
        return err({ kind: "browser-open", reason: errorMessage(e) });
      }
    },
  };
}
