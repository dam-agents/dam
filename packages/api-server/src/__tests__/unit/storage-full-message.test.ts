// TEST_OVERVIEW: The one storage-full message says what is refused at the owner's storage level: from 90% a sleeping VM agent can still be opened to clean up, and from 95% it cannot and running agents may be failing writes, and without figures it neither promises a start nor says starts are refused.
import { describe, expect, it } from "vitest";

import { storageFullMessage } from "../../modules/budgets/domain/vm-usage.js";

const GIB = 1024 ** 3;
const at = (percent: number) => ({
  usedBytes: percent * GIB,
  usableBytes: 100 * GIB,
});

describe("storageFullMessage", () => {
  // TEST_SCENARIO: At 92% a create is refused but a stopped agent still starts, so the message says it can be opened to clean up.
  it("offers opening a stopped agent below the start limit", () => {
    const msg = storageFullMessage(at(92));
    expect(msg).toContain("92.0 of 100.0 GiB");
    expect(msg).toContain("can still be started");
    expect(msg).not.toContain("failing to write");
  });

  // TEST_SCENARIO: At 95% starts are refused too.
  it("says stopped agents can't start once storage is nearly full", () => {
    const msg = storageFullMessage(at(95));
    expect(msg).toContain("can't be started");
    expect(msg).not.toContain("can still be started");
  });

  // TEST_SCENARIO: At 95% running agents may already be failing writes, and that comes first.
  it("leads with failing writes from 95%", () => {
    expect(storageFullMessage(at(95))).toMatch(
      /^Your running VM agents may be failing to write files now\./,
    );
  });

  // TEST_SCENARIO: A refused wake carries no figures and may come from a boot that failed below the start limit, so it neither promises a start nor says starts are refused now.
  it("hedges on starts without figures", () => {
    const msg = storageFullMessage();
    expect(msg).toContain("Once storage is nearly full");
    expect(msg).not.toContain("can still be started");
  });
});
