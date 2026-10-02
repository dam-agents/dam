import type { Decorator } from "@storybook/react-vite";
import { useState } from "react";

import { queryClient } from "@/query-client";

import { type Scenario, setScenario } from "../../backend/scenario";

/** Points the fake backend at `scenario` and drops cached queries before the
 *  story mounts, so a story never shows data left over from the previous one. */
export const inScenario =
  (scenario: Scenario): Decorator =>
  (Story) => {
    useState(() => {
      setScenario(scenario);
      queryClient.clear();
    });
    return <Story />;
  };
