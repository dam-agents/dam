import { describe, it, expect } from "vitest";
import { formatAuthRejection } from "../modules/shared/auth-message.js";

describe("formatAuthRejection", () => {
  it("points at `dam auth login` when DAM_TOKEN is not set", () => {
    const out = formatAuthRejection("session expired for host", {});
    expect(out).toContain("error: not authenticated: session expired for host");
    expect(out).toContain("hint: run `dam auth login` first");
    expect(out).not.toContain("DAM_TOKEN");
  });

  it("points at the rejected token, not login, when DAM_TOKEN is set", () => {
    const out = formatAuthRejection("session expired", { DAM_TOKEN: "pk_x" });
    expect(out).toContain("DAM_TOKEN was rejected");
    expect(out).not.toContain("dam auth login");
  });
});
