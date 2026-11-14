// TEST_OVERVIEW: the kit modal's line names the harness the kit pins, and the model it
// TEST_OVERVIEW: pins instead of the user's default, because the created Agent takes the
// TEST_OVERVIEW: kit's declaration; a kit that pins neither says nothing, since the
// TEST_OVERVIEW: platform default is not in the kit's data.
import type { StarterKitView } from "api-server-api";
import { describe, expect, test } from "vitest";

import { kitRunsOn } from "../../modules/starter-kits/lib/runs-on.js";

const kit = (fields: Partial<StarterKitView>) =>
  fields as Pick<StarterKitView, "image" | "harnesses" | "defaultModel">;

describe("kitRunsOn", () => {
  test("names the first harness the kit lists", () => {
    expect(kitRunsOn(kit({ harnesses: ["claude-code", "pi"] }))).toBe(
      "Harness: Claude",
    );
  });

  test("names an image's own harness over the kit's list", () => {
    expect(
      kitRunsOn(
        kit({
          image: { ref: "ghcr.io/dam-agents/nous:1", harness: "pi" },
          harnesses: ["claude-code"],
        }),
      ),
    ).toBe("Harness: Pi");
  });

  test("adds the model the kit pins, prettified", () => {
    expect(
      kitRunsOn(
        kit({ harnesses: ["claude-code"], defaultModel: "claude-opus-4-5" }),
      ),
    ).toBe("Harness: Claude · Model: Claude Opus 4.5");
  });

  test("keeps a model id the chat has no pretty name for", () => {
    expect(kitRunsOn(kit({ defaultModel: "zeta-instruct" }))).toBe(
      "Model: zeta-instruct",
    );
  });

  test("says nothing about a kit that pins neither", () => {
    expect(kitRunsOn(kit({ providers: ["ibm-litellm"] }))).toBeNull();
  });
});
