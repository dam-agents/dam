import type { SecurityCheckReportInput } from "api-server-api";
import type { Result } from "../../../result.js";
import type { AuthRequiredError, TransportError } from "../../shared/errors.js";
import { trpcCall } from "../../shared/trpc/classify.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";

export type SecurityCheckReported = Awaited<
  ReturnType<TrpcClient["securityChecks"]["report"]["mutate"]>
>;

export interface SecurityCheckService {
  report(
    input: SecurityCheckReportInput,
  ): Promise<Result<SecurityCheckReported, TransportError | AuthRequiredError>>;
}

export function createSecurityCheckService(deps: {
  trpc: TrpcClient;
}): SecurityCheckService {
  return {
    report: (input) =>
      trpcCall(() => deps.trpc.securityChecks.report.mutate(input)),
  };
}
