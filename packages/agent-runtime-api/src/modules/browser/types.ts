import type { z } from "zod";
import type { Result } from "../../result.js";
import type {
  browserSnapshotSchema,
  browserStateSchema,
  pageStateSchema,
} from "./schemas.js";

export type BrowserState = z.infer<typeof browserStateSchema>;
export type PageState = z.infer<typeof pageStateSchema>;
export type BrowserSnapshot = z.infer<typeof browserSnapshotSchema>;

export type BrowserDomainError =
  | { kind: "NotOffered" }
  | { kind: "NoDisplay" }
  | { kind: "NotWebAddress" }
  | { kind: "Failed"; detail: string };

export type BrowserAction =
  "reload" | "stop" | "back" | "forward" | "restart" | "clearData";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the browser panel's control of the agent's one
 * browser — the one agent-browser drives. Watching keeps it running and reports
 * its state and the page it shows; the actions are the panel's toolbar. Offered
 * only on an agent that requires named connections, and only on an image with
 * the display stack; otherwise every call answers why, before anything starts.
 */
export interface BrowserService {
  watch(
    signal?: AbortSignal,
  ): Result<AsyncIterable<BrowserSnapshot>, BrowserDomainError>;
  navigate(url: string): Promise<Result<void, BrowserDomainError>>;
  act(action: BrowserAction): Promise<Result<void, BrowserDomainError>>;
}
