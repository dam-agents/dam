import { describe, expect, it } from "vitest";

import { resourcesView } from "../../modules/budgets/lib/resources-view.js";
import type { AgentView } from "../../types.js";

/**
 * TEST_OVERVIEW: The home dashboard's resources card offers a switch only to a
 * user with both kinds of agent, and a remembered choice applies only then.
 */

const vm = { vm: true } as AgentView;
const container = { vm: false } as AgentView;

describe("resources card view", () => {
  it("shows the one view a single-kind user has, without a switch, whatever was remembered", () => {
    expect(resourcesView([vm], "container")).toEqual({
      view: "vm",
      switchable: false,
    });
    expect(resourcesView([container], "vm")).toEqual({
      view: "container",
      switchable: false,
    });
    expect(resourcesView([], null)).toEqual({
      view: "container",
      switchable: false,
    });
  });

  it("defaults a mixed user to the vm view and keeps their remembered choice", () => {
    expect(resourcesView([vm, container], null)).toEqual({
      view: "vm",
      switchable: true,
    });
    expect(resourcesView([vm, container], "container").view).toBe("container");
    expect(resourcesView([vm, container], "junk").view).toBe("vm");
  });
});
