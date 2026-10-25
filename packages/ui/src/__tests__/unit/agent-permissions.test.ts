// TEST_OVERVIEW: A Shared Agent's page tells an Agent Editor up front which sections only the owner changes. A section carries a lock when the viewer holds none of the Agent Permissions it needs; a section where they hold some, like Models, is not locked. With today's editor permissions that is People, and nothing else. The owner holds every permission, so their page has no lock. Notices name the owner by email, or a former user when the account is gone.
import { AGENT_PERMISSIONS, type AgentAccess } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import {
  isLockedSection,
  ownerName,
} from "../../modules/agents/lib/agent-permissions.js";
import {
  SandboxSectionNav,
  SECTIONS,
} from "../../modules/sandboxes/components/sandbox-section-nav.js";

const OWNER: AgentAccess = {
  role: "owner",
  editors: ["bob@example.com"],
  permissions: [...AGENT_PERMISSIONS],
};

const EDITOR: AgentAccess = {
  role: "editor",
  ownerEmail: "alice@example.com",
  editors: ["bob@example.com"],
  permissions: [
    "view",
    "settings",
    "envVars",
    "lifecycle",
    "spendLimits",
    "egressRules",
    "skills",
    "schedules",
    "chatForms",
    "environments",
  ],
};

const lockedFor = (access: AgentAccess) =>
  SECTIONS.map((e) => e.section).filter((s) => isLockedSection(access, s));

describe("locked sections", () => {
  // TEST_SCENARIO: AC-5. An editor sees a lock on People, and on no other section; the merged Models, Connections and Automations sections each hold work they may do.
  it("locks only the owner's sections for an editor", () => {
    expect(lockedFor(EDITOR)).toEqual(["people"]);
  });

  // TEST_SCENARIO: AC-10. The owner's page is unchanged: no section carries a lock.
  it("locks nothing for the owner", () => {
    expect(lockedFor(OWNER)).toEqual([]);
  });

  // TEST_SCENARIO: The nav shows a lock with a reason next to each locked section's name.
  it("marks each locked section in the nav", () => {
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(SandboxSectionNav, {
          sections: SECTIONS,
          active: "setup",
          onNavigate: () => {},
          locked: new Set(lockedFor(EDITOR)),
        }),
      ),
    );
    expect(html.match(/data-testid="section-lock"/g)).toHaveLength(1);
    expect(html).toContain("Only the owner changes this");
  });
});

describe("the owner named in a notice", () => {
  // TEST_SCENARIO: A notice says who to ask: the owner's email, or a former user when the owner's account is gone.
  it("names the owner, or a former user", () => {
    expect(ownerName(EDITOR)).toBe("alice@example.com");
    expect(ownerName({ ...EDITOR, ownerEmail: null })).toBe("a former user");
  });
});
