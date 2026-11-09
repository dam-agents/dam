// TEST_OVERVIEW: every Session report reaches the session directory, so a record
// TEST_OVERVIEW: kept outside it — the assistant's used mark, which decides the
// TEST_OVERVIEW: first landing and the greeting — learns the same fact there. A
// TEST_OVERVIEW: report of no Sessions says nothing.
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
  // TEST_SCENARIO: an agent reports a Session, so the hook is told which Agent it was.
  it("tells the hook which agent reported a session", async () => {
    const d = directory();
    await d.service.record("agent-a", [{ sessionId: "s1" }] as never);
    expect(d.record).toHaveBeenCalledTimes(1);
    expect(d.onRecorded).toHaveBeenCalledWith("agent-a");
  });

  // TEST_SCENARIO: an empty report is not a Session, so nothing is marked.
  it("says nothing for a report of no sessions", async () => {
    const d = directory();
    await d.service.record("agent-a", []);
    expect(d.onRecorded).not.toHaveBeenCalled();
  });
});
