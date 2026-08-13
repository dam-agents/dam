import open from "open";
import { err, ok, type Result } from "../../../result.js";
import type { BrowserOpenError } from "../domain/errors.js";

export interface BrowserOpener {
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
