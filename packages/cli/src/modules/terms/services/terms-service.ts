import {
  termsDocumentSchema,
  type TermsCurrent,
  type TermsDocument,
} from "api-server-api";
import { err, ok, type Result } from "../../../result.js";
import type { AuthRequiredError, TransportError } from "../../shared/errors.js";
import { trpcCall } from "../../shared/trpc/classify.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";

export type LatestAcceptance = Awaited<
  ReturnType<TrpcClient["terms"]["latestAcceptance"]["query"]>
>;

export interface TermsService {
  document(): Promise<Result<TermsDocument, TransportError>>;
  current(): Promise<Result<TermsCurrent, TransportError | AuthRequiredError>>;
  latestAcceptance(): Promise<
    Result<LatestAcceptance, TransportError | AuthRequiredError>
  >;
  accept(
    version: string,
  ): Promise<Result<void, TransportError | AuthRequiredError>>;
}

export function createTermsService(deps: {
  trpc: TrpcClient;
  host: string;
  fetch?: typeof fetch;
}): TermsService {
  const doFetch = deps.fetch ?? fetch;
  const base = deps.host.replace(/\/+$/, "");
  return {
    async document() {
      let res: Response;
      try {
        res = await doFetch(`${base}/api/terms`);
      } catch (e) {
        return err({
          kind: "transport",
          reason: e instanceof Error ? e.message : "cannot reach server",
        });
      }
      if (!res.ok)
        return err({
          kind: "transport",
          reason: `GET /api/terms returned ${res.status}`,
        });
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        return err({
          kind: "transport",
          reason: "malformed Terms of Use document from server",
        });
      }
      const parsed = termsDocumentSchema.safeParse(body);
      if (!parsed.success)
        return err({
          kind: "transport",
          reason: "malformed Terms of Use document from server",
        });
      return ok(parsed.data);
    },
    async current() {
      return trpcCall(() => deps.trpc.terms.current.query());
    },
    async latestAcceptance() {
      return trpcCall(() => deps.trpc.terms.latestAcceptance.query());
    },
    async accept(version) {
      return trpcCall(() => deps.trpc.terms.accept.mutate({ version }));
    },
  };
}
