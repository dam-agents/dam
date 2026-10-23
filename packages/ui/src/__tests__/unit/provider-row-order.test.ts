// TEST_OVERVIEW: Settings / Providers lists the providers in one fixed order — the deployment's CurveBender ahead of the user-keyed one, then IBM ETE LiteLLM, Bob Shell, AWS Bedrock, Anthropic and OpenAI — and the picker shares that list, so the two surfaces cannot drift apart.
import { describe, expect, it } from "vitest";

import {
  PROVIDER_ROWS,
  type ProviderRowDef,
} from "../../modules/providers/lib/provider-rows.js";

const key = (row: ProviderRowDef) => `${row.type}:${row.templateId ?? ""}`;

describe("provider row order", () => {
  // TEST_SCENARIO: the rows read in the order a user expects: the deployment's CurveBender before the user's own, internal endpoints next, and the public vendors last.
  it("lists the providers in the order the section shows them", () => {
    expect(PROVIDER_ROWS.map(key)).toEqual([
      "curve-bender:curve-bender-deployment",
      "curve-bender:curve-bender",
      "ibm-litellm:",
      "bob:",
      "bedrock:",
      "anthropic:",
      "openai:",
    ]);
  });
});
