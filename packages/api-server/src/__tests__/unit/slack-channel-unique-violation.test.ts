import { describe, it, expect } from "vitest";
import {
  isSlackChannelUniqueViolation,
  isSlackDefaultUniqueViolation,
} from "../../modules/agents/infrastructure/channel-bindings-repository.js";

const driverError = {
  code: "23505",
  constraint_name: "channels_slack_agent_channel_idx",
};

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
        constraint_name: "channels_slack_agent_channel_idx",
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

describe("isSlackDefaultUniqueViolation", () => {
  const defaultViolation = {
    code: "23505",
    constraint_name: "channels_slack_default_agent_idx",
  };

  /**
   * TEST_SCENARIO: two callers can race to claim a vacant default — the
   * NOT EXISTS guard is evaluated once per statement, so the index is what
   * actually settles it. Losing that race means a default already exists,
   * which is the outcome the caller wanted, not an error to surface.
   */
  it("matches a violation of the one-default-per-conversation index", () => {
    expect(isSlackDefaultUniqueViolation(defaultViolation)).toBe(true);
  });

  it("matches it through a wrapped cause chain", () => {
    expect(
      isSlackDefaultUniqueViolation(
        new DrizzleQueryErrorLike(defaultViolation),
      ),
    ).toBe(true);
  });

  it("does not confuse the two channel indexes", () => {
    expect(isSlackDefaultUniqueViolation(driverError)).toBe(false);
    expect(isSlackChannelUniqueViolation(defaultViolation)).toBe(false);
  });
});
