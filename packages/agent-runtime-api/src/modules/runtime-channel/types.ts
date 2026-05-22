import type { Result } from "../../result.js";
import type {
  RuntimeChannelApplyStateResult,
  SignalEvent,
  StateEvent,
} from "api-server-api";

export type RuntimeChannelDomainError =
  | { kind: "OlderVersion"; currentVersion: string }
  | { kind: "MissingCapability"; missing: string[] }
  | { kind: "ApplyFailed"; reason: string };

export interface RuntimeChannelService {
  applyState(
    event: StateEvent,
  ): Promise<Result<RuntimeChannelApplyStateResult, RuntimeChannelDomainError>>;
  deliverSignal(
    event: SignalEvent,
  ): Promise<Result<{ ok: true }, RuntimeChannelDomainError>>;
}

export type {
  Contribution,
  RuntimeChannelApplyStateResult,
  SignalEvent,
  StateEvent,
} from "api-server-api";
