// TEST_OVERVIEW: every Session report reaches the session directory, so a record
// TEST_OVERVIEW: kept outside it — the assistant's used mark, which decides the
// TEST_OVERVIEW: first landing and the greeting — learns the same fact there, with
// TEST_OVERVIEW: the Sessions it carries. A report of no Sessions says nothing.
import { describe, expect, it, vi } from "vitest";

import { createSessionDirectoryService } from "../../modules/session-directory/services/session-directory-service.js";

function directory() {
  const record = vi.fn(async () => {});
  const onRecorded = vi.fn(async () => {});
  const service = createSessionDirectoryService({
    repo: { record } as never,
    onRecorded,
  });
  return { record, onRecorded, service };
}

describe("the session directory's report hook", () => {
  // TEST_SCENARIO: an agent reports Sessions, so the hook is told which Agent it was and which Sessions they are, since their start decides whether the report is a new use.
  it("tells the hook which agent reported, and which sessions", async () => {
    const d = directory();
    const sessions = [{ sessionId: "s1" }];
    await d.service.record("agent-a", sessions as never);
    expect(d.record).toHaveBeenCalledTimes(1);
    expect(d.onRecorded).toHaveBeenCalledWith("agent-a", sessions);
  });

  // TEST_SCENARIO: an empty report is not a Session, so nothing is marked.
  it("says nothing for a report of no sessions", async () => {
    const d = directory();
    await d.service.record("agent-a", []);
    expect(d.onRecorded).not.toHaveBeenCalled();
  });
});
