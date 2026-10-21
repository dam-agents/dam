// TEST_OVERVIEW: `dam agent create` asks the user to pick or add a provider. A personal credential replaces the caller's own Connection of that type, never the deployment's CurveBender, whose key the user cannot replace.
import { describe, expect, it } from "vitest";
import type { ProviderPresetType } from "api-server-api";

import {
  type ExistingProviderConn,
  personalProviderConn,
} from "../modules/agent/commands/create-interactive.js";

const conn = (
  id: string,
  templateId: string,
  type: ProviderPresetType,
): ExistingProviderConn => ({ id, name: id, templateId, type });

describe("personal provider lookup", () => {
  // TEST_SCENARIO: with only the deployment's CurveBender present, adding a personal key gets no Connection to replace, so the flow asks for the key and creates one; the personal CurveBender, not the deployment's, is the one a second personal key replaces.
  it("skips the deployment's CurveBender and keeps the user's own", () => {
    const shared = conn("cb-shared", "curve-bender-deployment", "curve-bender");
    const personal = conn("cb-mine", "curve-bender", "curve-bender");

    expect(personalProviderConn([shared], "curve-bender")).toBeUndefined();
    expect(personalProviderConn([personal], "curve-bender")).toBe(personal);
    expect(personalProviderConn([shared, personal], "curve-bender")).toBe(
      personal,
    );
  });
});
