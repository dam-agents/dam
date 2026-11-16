// TEST_OVERVIEW: The Share dialog lists who can open an artifact. A choice that an artifact cannot have is not listed: a note with the reason stands in its place, so the user learns why and which choices remain.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { ShareVisibilityChoice } from "../../modules/artifacts/components/share-visibility-choice.js";

const REASON = "Only people you invite can use interactive artifacts.";

function render(unavailable?: { public: string }): string {
  return renderToStaticMarkup(
    createElement(ShareVisibilityChoice, {
      value: "private",
      onChange: () => {},
      disabled: false,
      unavailable,
    }),
  );
}

// TEST_SCENARIO: An artifact that can be public. The dialog offers all three choices and no note.
it("offers every choice when none is unavailable", () => {
  const html = render();

  expect(html).toContain('data-testid="share-visibility-private"');
  expect(html).toContain('data-testid="share-visibility-restricted"');
  expect(html).toContain('data-testid="share-visibility-public"');
  expect(html).not.toContain('role="note"');
});

// TEST_SCENARIO: An interactive artifact can never be public. The public choice is gone and the reason is shown where it was, after the restricted choice.
it("shows the reason in place of an unavailable choice", () => {
  const html = render({ public: REASON });

  expect(html).not.toContain('data-testid="share-visibility-public"');
  expect(html).toContain(REASON);
  expect(html.indexOf(REASON)).toBeGreaterThan(
    html.indexOf('data-testid="share-visibility-restricted"'),
  );
});
