import type { ResolveError } from "../../instance/index.js";
import type { SessionDecisionError } from "./session-resolution.js";

export type ChatError =
  | ResolveError
  | SessionDecisionError
  | { kind: "no-server" }
  | { kind: "malformed-config"; reason: string }
  | { kind: "below-floor"; localCli: string; serverMinClient: string }
  | { kind: "not-a-tty" }
  | { kind: "session-failed"; reason: string }
  | { kind: "mode-switch-declined" };
