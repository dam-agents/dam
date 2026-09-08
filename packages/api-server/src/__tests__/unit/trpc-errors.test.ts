import { TRPCError } from "@trpc/server";
import { getErrorShape } from "@trpc/server/unstable-core-do-not-import";
import type { ApiContext } from "api-server-api";
import { markTermsProven, t } from "api-server-api/trpc";
import { describe, expect, it } from "vitest";

/* TEST_OVERVIEW: The tRPC layer must not hand internal failures to clients as they are: a Postgres error from a malformed id or a duplicate row becomes a client error code, and whatever stays a 500 loses its message and stack. */

function pgError(code: string): Error {
  return new Error("Failed query: insert into ...", {
    cause: Object.assign(new Error("db"), { code }),
  });
}

const router = t.router({
  fail: t.procedure
    .input((v: unknown) => v as Error)
    .mutation(({ input }) => {
      throw input;
    }),
});

function caller() {
  const ctx = {} as ApiContext;
  markTermsProven(ctx);
  return { call: t.createCallerFactory(router)(ctx), ctx };
}

describe("tRPC error mapping", () => {
  /* TEST_SCENARIO: An id that is not a UUID makes Postgres reject the cast (SQLSTATE 22P02); the caller must see BAD_REQUEST, not a 500. */
  it("maps invalid text representation to BAD_REQUEST", async () => {
    await expect(caller().call.fail(pgError("22P02"))).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  /* TEST_SCENARIO: A NUL byte inside a string makes Postgres reject the value (SQLSTATE 22021); the caller must see BAD_REQUEST. */
  it("maps character-not-in-repertoire to BAD_REQUEST", async () => {
    await expect(caller().call.fail(pgError("22021"))).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  /* TEST_SCENARIO: A duplicate row violates a unique index (SQLSTATE 23505); the caller must see CONFLICT. */
  it("maps unique violation to CONFLICT", async () => {
    await expect(caller().call.fail(pgError("23505"))).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  /* TEST_SCENARIO: Any other thrown Error stays INTERNAL_SERVER_ERROR, and the shape sent to the client carries neither its message nor a stack. */
  it("redacts message and stack of internal errors", () => {
    const { ctx } = caller();
    const shape = getErrorShape({
      config: router._def._config,
      error: new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        cause: pgError("XX000"),
      }),
      type: "mutation",
      path: "fail",
      input: undefined,
      ctx,
    });
    expect(shape.message).toBe("internal server error");
    expect(shape.data.stack).toBeUndefined();
    expect(shape.data.code).toBe("INTERNAL_SERVER_ERROR");
  });

  /* TEST_SCENARIO: tRPC's own 415 quotes the request's Content-Type header; the client must not get that header echoed back. */
  it("redacts the echoed content-type of UNSUPPORTED_MEDIA_TYPE", () => {
    const { ctx } = caller();
    const shape = getErrorShape({
      config: router._def._config,
      error: new TRPCError({
        code: "UNSUPPORTED_MEDIA_TYPE",
        message: 'Unsupported content-type "<script>"',
      }),
      type: "mutation",
      path: "fail",
      input: undefined,
      ctx,
    });
    expect(shape.message).toBe("unsupported content-type");
  });

  /* TEST_SCENARIO: Client errors keep their message so validation feedback still reaches the UI. */
  it("keeps the message of client errors", () => {
    const { ctx } = caller();
    const shape = getErrorShape({
      config: router._def._config,
      error: new TRPCError({
        code: "BAD_REQUEST",
        message: "unknown template",
      }),
      type: "mutation",
      path: "fail",
      input: undefined,
      ctx,
    });
    expect(shape.message).toBe("unknown template");
    expect(shape.data.stack).toBeUndefined();
  });
});
