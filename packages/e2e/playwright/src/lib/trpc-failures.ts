import assert from "node:assert/strict";

import {
  createTRPCUntypedClient,
  httpBatchLink,
  TRPCClientError,
  type TRPCLink,
} from "@trpc/client";
import type { AnyTRPCRouter } from "@trpc/server";
import { observable } from "@trpc/server/observable";

const bodyLimit = 2_000;

// UNIT_BOUNDARY_DESCRIPTION: a failed tRPC call in a spec names its procedure, its HTTP status and the error body the api-server sent, or the transport error under a fetch that never got an answer. tRPC's own error carries only the redacted message — a 500 reads "internal server error" — and its stack ends in httpBatchLink, so a spec that makes several calls in node-side setup fails with nothing that says which call it was. The rethrown error is a TRPCClientError with the same shape, data and cause, so a spec that reads `data.code` or matches the message still does.
export function namedFailures<
  TRouter extends AnyTRPCRouter,
>(): TRPCLink<TRouter> {
  return () =>
    ({ op, next }) =>
      observable((observer) =>
        next(op).subscribe({
          next: (result) => observer.next(result),
          complete: () => observer.complete(),
          error: (err) => observer.error(named(op.path, err)),
        }),
      );
}

function named<TRouter extends AnyTRPCRouter>(
  path: string,
  err: TRPCClientError<TRouter>,
): TRPCClientError<TRouter> {
  const response = err.meta?.response as { status?: number } | undefined;
  const transport = (err.cause as { cause?: unknown } | undefined)?.cause;
  const message = [
    `${path} failed:`,
    response?.status,
    err.message,
    err.shape ? JSON.stringify(err.shape).slice(0, bodyLimit) : undefined,
    transport === undefined ? undefined : `(${String(transport)})`,
  ]
    .filter((part) => part !== undefined)
    .join(" ");
  return new TRPCClientError<TRouter>(message, {
    result: err.shape ? { error: err.shape } : undefined,
    cause: err.cause,
    meta: err.meta,
  });
}

// UNIT_BOUNDARY_DESCRIPTION: the fetch the specs' tRPC clients send through. An error answer that is not JSON — a gateway's 503 page, an ingress's 404 — makes tRPC's own JSON parse fail, and the spec then reads only the parse error. This turns such an answer into an error that carries its status and the start of its body. A JSON answer passes through as it came.
export function bodyKeepingFetch(base: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const res = await base(input, init);
    if (res.ok) return res;
    const body = await res.clone().text();
    try {
      JSON.parse(body);
    } catch {
      throw new Error(
        `HTTP ${res.status} ${res.statusText}: ${body.slice(0, bodyLimit)}`,
      );
    }
    return res;
  };
}

if (import.meta.main) {
  const answering = (res: () => Response) =>
    createTRPCUntypedClient<AnyTRPCRouter>({
      links: [
        namedFailures(),
        httpBatchLink({
          url: "http://e2e.invalid/api/trpc",
          fetch: bodyKeepingFetch(async () => res()),
        }),
      ],
    });
  const failure = async (call: Promise<unknown>) => {
    try {
      await call;
    } catch (err) {
      assert.ok(
        err instanceof TRPCClientError,
        `not a TRPCClientError: ${err}`,
      );
      return err as TRPCClientError<AnyTRPCRouter>;
    }
    throw new Error("the call resolved");
  };

  const shape = {
    message: "internal server error",
    code: -32603,
    data: {
      code: "INTERNAL_SERVER_ERROR",
      httpStatus: 500,
      path: "agents.create",
    },
  };
  const internal = await failure(
    answering(
      () => new Response(JSON.stringify([{ error: shape }]), { status: 500 }),
    ).mutation("agents.create", { name: "e2e-agent" }),
  );
  assert.match(
    internal.message,
    /^agents\.create failed: 500 internal server error \{.*"httpStatus":500/,
  );
  assert.equal(internal.data?.code, "INTERNAL_SERVER_ERROR");

  const gateway = await failure(
    answering(
      () =>
        new Response("upstream connect error or disconnect/reset", {
          status: 503,
          statusText: "Service Unavailable",
        }),
    ).query("agents.list"),
  );
  assert.equal(
    gateway.message,
    "agents.list failed: HTTP 503 Service Unavailable: upstream connect error or disconnect/reset",
  );

  const refused = await failure(
    answering(() => {
      throw new TypeError("fetch failed", {
        cause: new Error("connect ECONNREFUSED 127.0.0.1:5555"),
      });
    }).query("agents.list"),
  );
  assert.equal(
    refused.message,
    "agents.list failed: fetch failed (Error: connect ECONNREFUSED 127.0.0.1:5555)",
  );

  const listed = await answering(
    () => new Response(JSON.stringify([{ result: { data: [] } }])),
  ).query("agents.list");
  assert.deepEqual(listed, []);
  console.log("trpc-failures self-check OK");
}
