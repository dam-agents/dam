// TEST_OVERVIEW: an Activity row marks a Session waiting on the user's approval with the same approval dot as every Session list, in place of the working and unread marks, and names an untitled Session as every Session list does.
import type { AttentionItem } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { SidebarActivityRow } from "../../modules/home/components/sidebar-activity-row.js";
import type { AgentActivitySession } from "../../modules/home/hooks/use-activity-sessions.js";
import type { AgentView } from "../../types.js";

function row(
  flags: {
    needsApproval: boolean;
    working: boolean;
    unread: boolean;
  },
  title: string | null = "Fix the build",
) {
  const item = {
    id: "a1:s1",
    session: { title, sessionId: "5f3c9a1e-77aa" } as AttentionItem,
    agent: { name: "Karel" } as AgentView,
    at: "2026-10-19T12:00:00Z",
    ...flags,
  } as AgentActivitySession;
  return renderToStaticMarkup(
    createElement(SidebarActivityRow, {
      item,
      selected: false,
      now: new Date("2026-10-19T12:05:00Z"),
      conversation: undefined,
      onOpen: () => {},
    }),
  );
}

// TEST_SCENARIO: a waiting Session shows the approval dot, and neither the working dots nor the unread dot.
it("shows the approval dot for a waiting Session", () => {
  const html = row({ needsApproval: true, working: true, unread: true });
  expect(html).toContain('data-testid="session-approval-dot"');
  expect(html).toContain('aria-label="Needs your approval"');
  expect(html).not.toContain("(unread)");
  expect(html).not.toContain('title="Working"');
});

// TEST_SCENARIO: a Session with nothing to approve shows no approval dot.
it("shows no approval dot otherwise", () => {
  const html = row({ needsApproval: false, working: false, unread: true });
  expect(html).not.toContain("session-approval-dot");
  expect(html).toContain("(unread)");
});

// TEST_SCENARIO: an untitled Session shows "(no title · <id>)", as in every other Session list.
it("names an untitled Session as every Session list does", () => {
  const html = row(
    { needsApproval: false, working: false, unread: false },
    null,
  );
  expect(html).toContain("(no title · 5f3c9a1e)");
});
