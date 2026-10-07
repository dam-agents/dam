import open from "open";
import { err, ok, type Result } from "../../../result.js";
import type { BrowserOpenError } from "../domain/errors.js";
import { errorMessage } from "../../shared/error-message.js";

export interface BrowserOpener {
  open(url: string): Promise<Result<void, BrowserOpenError>>;
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
