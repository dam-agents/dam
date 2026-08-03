import type {
  ApprovalActionOutcome,
  ApprovalListOptions,
  ApprovalView,
} from "api-server-api";
import type { Result } from "../../../result.js";
import type { AuthRequiredError, TransportError } from "../../shared/errors.js";
import { trpcCall } from "../../shared/trpc/classify.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";

export interface ApprovalService {
  listForOwner(
    opts?: ApprovalListOptions,
  ): Promise<
    Result<readonly ApprovalView[], TransportError | AuthRequiredError>
  >;
  listForInstance(
    agentId: string,
    opts?: ApprovalListOptions,
  ): Promise<
    Result<readonly ApprovalView[], TransportError | AuthRequiredError>
  >;
  approveOnce(
    id: string,
  ): Promise<Result<ApprovalActionOutcome, TransportError | AuthRequiredError>>;
  approvePermanent(
    id: string,
  ): Promise<Result<ApprovalActionOutcome, TransportError | AuthRequiredError>>;
  approveHost(
    id: string,
  ): Promise<Result<ApprovalActionOutcome, TransportError | AuthRequiredError>>;
  denyForever(
    id: string,
  ): Promise<Result<ApprovalActionOutcome, TransportError | AuthRequiredError>>;
  dismiss(
    id: string,
  ): Promise<Result<ApprovalActionOutcome, TransportError | AuthRequiredError>>;
}

export function createApprovalService(deps: {
  trpc: TrpcClient;
}): ApprovalService {
  return {
    async listForOwner(opts) {
      return trpcCall(() => deps.trpc.approvals.listForOwner.query(opts));
    },
    async listForInstance(agentId, opts) {
      return trpcCall(() =>
        deps.trpc.approvals.listForInstance.query({ agentId, ...opts }),
      );
    },
    async approveOnce(id) {
      return trpcCall(() => deps.trpc.approvals.approveOnce.mutate({ id }));
    },
    async approvePermanent(id) {
      return trpcCall(() =>
        deps.trpc.approvals.approvePermanent.mutate({ id }),
      );
    },
    async approveHost(id) {
      return trpcCall(() => deps.trpc.approvals.approveHost.mutate({ id }));
    },
    async denyForever(id) {
      return trpcCall(() => deps.trpc.approvals.denyForever.mutate({ id }));
    },
    async dismiss(id) {
      return trpcCall(() => deps.trpc.approvals.dismiss.mutate({ id }));
    },
  };
}
