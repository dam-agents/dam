import type { z } from "zod";
import type { Result } from "../../result.js";
import type {
  browserSnapshotSchema,
  browserStateSchema,
  pageStateSchema,
  tabStateSchema,
} from "./schemas.js";

export type BrowserState = z.infer<typeof browserStateSchema>;
export type PageState = z.infer<typeof pageStateSchema>;
export type TabState = z.infer<typeof tabStateSchema>;
export type BrowserSnapshot = z.infer<typeof browserSnapshotSchema>;

export type BrowserDomainError =
  | { kind: "NotOffered" }
  | { kind: "NoDisplay" }
  | { kind: "NotWebAddress" }
  | { kind: "TabGone" }
  | { kind: "Failed"; detail: string };

export type TabAction = "reload" | "stop" | "back" | "forward";

export type BrowserAction = TabAction | "restart" | "clearData";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the browser panel's control of the agent's one
 * browser — the one agent-browser drives. Watching keeps it running and reports
 * its state, its tabs, the one on screen and its page; the actions are the
 * panel's toolbar and tab bar, each on the tab it names — or the one on screen
 * when it names none — and refused when that tab is gone; a new tab answers
 * with its target id. Offered only on an agent that requires named
 * connections, and only on an image with the display stack; otherwise every
 * call answers why, before anything starts.
 */
export interface BrowserService {
  watch(
    signal?: AbortSignal,
  ): Result<AsyncIterable<BrowserSnapshot>, BrowserDomainError>;
  navigate(
    url: string,
    tab?: string,
  ): Promise<Result<void, BrowserDomainError>>;
  act(
    action: BrowserAction,
    tab?: string,
  ): Promise<Result<void, BrowserDomainError>>;
  selectTab(tab: string): Promise<Result<void, BrowserDomainError>>;
  newTab(): Promise<Result<string, BrowserDomainError>>;
  closeTab(tab: string): Promise<Result<void, BrowserDomainError>>;
}
