import { describe, it, expect } from "vitest";
import { isSlackChannelUniqueViolation } from "../../modules/agents/infrastructure/channel-bindings-repository.js";

// Shape of the postgres.js error raised when the partial unique index
// `channels_slack_channel_unique_idx` is violated (one Slack channel per agent).
const driverError = {
  code: "23505",
  constraint_name: "channels_slack_channel_unique_idx",
};

// Drizzle (>=0.44) re-throws driver failures wrapped in a DrizzleQueryError
// whose message is `Failed query: ...` and which carries the original error on
// `.cause`. This is what `connectSlack`'s catch block actually receives.
class DrizzleQueryErrorLike extends Error {
  cause: unknown;
  constructor(cause: unknown) {
    super('Failed query: insert into "channels" ...\nparams: ...');
    this.cause = cause;
  }
}

describe("isSlackChannelUniqueViolation", () => {
  it("matches the raw postgres.js unique violation", () => {
    expect(isSlackChannelUniqueViolation(driverError)).toBe(true);
  });

  it("matches when the violation is wrapped in a DrizzleQueryError (.cause)", () => {
    expect(
      isSlackChannelUniqueViolation(new DrizzleQueryErrorLike(driverError)),
    ).toBe(true);
  });

  it("matches when nested deeper in the cause chain", () => {
    const nested = new DrizzleQueryErrorLike(
      new DrizzleQueryErrorLike(driverError),
    );
    expect(isSlackChannelUniqueViolation(nested)).toBe(true);
  });

  it("ignores a unique violation on a different constraint", () => {
    expect(
      isSlackChannelUniqueViolation({
        code: "23505",
        constraint_name: "channels_agent_type_idx",
      }),
    ).toBe(false);
  });

  it("ignores a different postgres error code", () => {
    expect(
      isSlackChannelUniqueViolation({
        code: "23503",
        constraint_name: "channels_slack_channel_unique_idx",
      }),
    ).toBe(false);
  });

  it("returns false for non-error values", () => {
    expect(isSlackChannelUniqueViolation(null)).toBe(false);
    expect(isSlackChannelUniqueViolation(undefined)).toBe(false);
    expect(isSlackChannelUniqueViolation("boom")).toBe(false);
  });

  it("does not loop forever on a self-referential cause chain", () => {
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;
    expect(isSlackChannelUniqueViolation(cyclic)).toBe(false);
  });
});
