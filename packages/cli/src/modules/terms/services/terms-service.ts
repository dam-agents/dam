import {
  termsDocumentSchema,
  type TermsCurrent,
  type TermsDocument,
} from "api-server-api";
import { err, ok, type Result } from "../../../result.js";
import type { AuthRequiredError, TransportError } from "../../shared/errors.js";
import { trpcCall } from "../../shared/trpc/classify.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";

/** The caller's latest acceptance as it arrives over the wire — the tRPC
 *  surface uses no date transformer, so `acceptedAt` is an ISO string here,
 *  not the server-side `Date`. */
export type LatestAcceptance = Awaited<
  ReturnType<TrpcClient["terms"]["latestAcceptance"]["query"]>
>;

/**
 * CLI-side view of the terms surface. Metadata and acceptance go over tRPC
 * (`terms.*`, exempt from the 412 gate so they run while the caller is still
 * gated); the document text is served only at the plain, auth-exempt
 * `GET /api/terms`, so it is fetched directly rather than over tRPC.
 */
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
