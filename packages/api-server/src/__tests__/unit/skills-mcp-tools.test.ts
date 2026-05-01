import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import { textTool } from "../../apps/harness-api-server/mcp-endpoint.js";

describe("textTool wrapper", () => {
  it("wraps a successful call with the formatter output", async () => {
    const res = await textTool(
      "fallback",
      async () => ({ count: 3 }),
      (r) => `count=${r.count}`,
    );
    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toBe("count=3");
  });

  it("maps PRECONDITION_FAILED to a running-instance hint", async () => {
    const res = await textTool(
      "fallback",
      async () => {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "instance is hibernated" });
      },
      () => "ok",
    );
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/running/);
    expect(res.content[0].text).toMatch(/hibernated/);
  });

  it("prefixes NOT_FOUND with 'not found:'", async () => {
    const res = await textTool(
      "fallback",
      async () => {
        throw new TRPCError({ code: "NOT_FOUND", message: "skill source \"ghost\" not found" });
      },
      () => "ok",
    );
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("not found:");
    expect(res.content[0].text).toContain("ghost");
  });

  it("surfaces other TRPCError messages plainly", async () => {
    const res = await textTool(
      "fallback",
      async () => {
        throw new TRPCError({ code: "FORBIDDEN", message: "denied" });
      },
      () => "ok",
    );
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe("denied");
  });

  it("falls back to err.message for plain Error", async () => {
    const res = await textTool(
      "fallback",
      async () => {
        throw new Error("disk full");
      },
      () => "ok",
    );
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe("disk full");
  });

  it("uses the provided fallback for non-Error throwables", async () => {
    const res = await textTool(
      "fallback",
      async () => {
        throw "weird";
      },
      () => "ok",
    );
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe("fallback");
  });
});
