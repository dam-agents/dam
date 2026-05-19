import { describe, it, expect, vi } from "vitest";
import { retry } from "../../modules/agents/infrastructure/retry.js";

describe("retry", () => {
  it("retries until success", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce("ok");
    expect(await retry(fn, () => true, 5, 0)).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("rethrows non-retriable errors immediately, unwrapped", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fatal"));
    await expect(retry(fn, () => false, 5, 0)).rejects.toThrow("fatal");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("wraps the last error after exhausting attempts, naming fn and preserving cause", async () => {
    async function tfn() {
      throw new Error("conflict");
    }
    await expect(retry(tfn, () => true, 3, 0)).rejects.toMatchObject({
      message: "retry(tfn): failed after 3 attempts",
      cause: expect.objectContaining({ message: "conflict" }),
    });
  });
});
