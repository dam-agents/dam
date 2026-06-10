import type { inferRouterOutputs } from "@trpc/server";
import type {
  AppRouter,
  ScheduleCreateRRuleInput,
  ScheduleUpdateRRuleInput,
} from "api-server-api";
import { err, ok, type Result } from "../../../result.js";
import { classifyTrpcError, trpcCall } from "../../shared/trpc/classify.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";
import type {
  AuthRequiredError,
  InvalidInputError,
  ScheduleNotFoundError,
  TransportError,
} from "../domain/errors.js";

// The router returns a structural view (`toView`), not a named contract type.
// Derive the CLI-local alias from the inferred router output rather than
// adding a contract type. NB: this is *not* a discriminated union — `type`
// carries the full `"cron" | "rrule"` in both shapes, so callers discriminate
// on the nullable `rrule` field, not on `type`.
export type ScheduleView = inferRouterOutputs<AppRouter>["schedules"]["get"];

function codeOf(e: unknown): string | undefined {
  return (e as { data?: { code?: string } } | undefined)?.data?.code;
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : "invalid schedule input";
}

export interface ScheduleService {
  list(
    agentId: string,
  ): Promise<
    Result<readonly ScheduleView[], TransportError | AuthRequiredError>
  >;
  get(
    id: string,
  ): Promise<
    Result<
      ScheduleView,
      TransportError | AuthRequiredError | ScheduleNotFoundError
    >
  >;
  createRRule(
    input: ScheduleCreateRRuleInput,
  ): Promise<
    Result<ScheduleView, TransportError | AuthRequiredError | InvalidInputError>
  >;
  updateRRule(
    input: ScheduleUpdateRRuleInput,
  ): Promise<
    Result<
      ScheduleView,
      | TransportError
      | AuthRequiredError
      | ScheduleNotFoundError
      | InvalidInputError
    >
  >;
  toggle(
    id: string,
  ): Promise<
    Result<
      ScheduleView,
      TransportError | AuthRequiredError | ScheduleNotFoundError
    >
  >;
  delete(id: string): Promise<Result<void, TransportError | AuthRequiredError>>;
  resetSession(
    id: string,
  ): Promise<Result<void, TransportError | AuthRequiredError>>;
}

export function createScheduleService(deps: {
  trpc: TrpcClient;
}): ScheduleService {
  return {
    async list(agentId) {
      return trpcCall(
        () =>
          deps.trpc.schedules.list.query({ agentId }) as Promise<
            readonly ScheduleView[]
          >,
      );
    },
    async get(id) {
      try {
        return ok(await deps.trpc.schedules.get.query({ id }));
      } catch (e) {
        if (codeOf(e) === "NOT_FOUND") {
          return err({ kind: "schedule-not-found", id });
        }
        return classifyTrpcError(e);
      }
    },
    async createRRule(input) {
      try {
        return ok(await deps.trpc.schedules.createRRule.mutate(input));
      } catch (e) {
        if (codeOf(e) === "BAD_REQUEST") {
          return err({ kind: "invalid-input", message: messageOf(e) });
        }
        return classifyTrpcError(e);
      }
    },
    async updateRRule(input) {
      try {
        return ok(await deps.trpc.schedules.updateRRule.mutate(input));
      } catch (e) {
        const code = codeOf(e);
        if (code === "NOT_FOUND") {
          return err({ kind: "schedule-not-found", id: input.id });
        }
        if (code === "BAD_REQUEST") {
          return err({ kind: "invalid-input", message: messageOf(e) });
        }
        return classifyTrpcError(e);
      }
    },
    async toggle(id) {
      try {
        return ok(await deps.trpc.schedules.toggle.mutate({ id }));
      } catch (e) {
        if (codeOf(e) === "NOT_FOUND") {
          return err({ kind: "schedule-not-found", id });
        }
        return classifyTrpcError(e);
      }
    },
    async delete(id) {
      // Server is idempotent on delete — unknown ids return without throwing.
      return trpcCall(async () => {
        await deps.trpc.schedules.delete.mutate({ id });
      });
    },
    async resetSession(id) {
      return trpcCall(async () => {
        await deps.trpc.schedules.resetSession.mutate({ id });
      });
    },
  };
}
