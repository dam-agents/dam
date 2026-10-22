// TEST_OVERVIEW: a pasted link to a kit's repository is reduced to the <owner>/<repo> the platform reads; anything that is not a public GitHub repository's own address is refused before a request is made.
import { describe, expect, it } from "vitest";

import {
  kitLinkSlug,
  kitLinkUrl,
} from "../../modules/starter-kits/lib/kit-link.js";

describe("kit link", () => {
  // TEST_SCENARIO: people paste a repository address in the shapes GitHub hands out — with or without the scheme, with a trailing slash, as a clone URL — and all of them name the same kit.
  it.each([
    "https://github.com/acme/shared-kit",
    "https://github.com/acme/shared-kit/",
    "https://github.com/acme/shared-kit.git",
    "github.com/acme/shared-kit",
    "  https://www.github.com/acme/shared-kit  ",
  ])("reads %s as acme/shared-kit", (pasted) => {
    expect(kitLinkSlug(pasted)).toBe("acme/shared-kit");
  });

  // TEST_SCENARIO: a link into a branch or folder names a version the kit would not be read at, and other hosts are not read at all, so neither is taken as a kit.
  it.each([
    "https://github.com/acme/shared-kit/tree/main/kits/a",
    "https://github.com/acme",
    "https://gitlab.com/acme/shared-kit",
    "https://github.ibm.com/acme/shared-kit",
    "http://github.com/acme/shared-kit",
    "git@github.com:acme/shared-kit.git",
    "https://github.com/acme/..",
    "",
  ])("refuses %s", (pasted) => {
    expect(kitLinkSlug(pasted)).toBeNull();
  });

  it("turns a slug back into the repository URL", () => {
    expect(kitLinkUrl("acme/shared-kit")).toBe(
      "https://github.com/acme/shared-kit",
    );
  });
});
