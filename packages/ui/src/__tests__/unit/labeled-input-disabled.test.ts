import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { LabeledInput } from "../../modules/connections/forms/labeled-input.js";

// TEST_SCENARIO: the secret page checks a pasted secret before it saves it. A field edited while that check runs would be saved by a form whose values were read before the edit, so the inputs lock until the check answers.
test("a disabled field renders locked, a normal one does not", () => {
  const disabled = renderToStaticMarkup(
    createElement(LabeledInput, {
      label: "API key",
      value: "",
      onChange: () => {},
      disabled: true,
    }),
  );
  expect(disabled).toContain('disabled=""');
  const enabled = renderToStaticMarkup(
    createElement(LabeledInput, {
      label: "API key",
      value: "",
      onChange: () => {},
    }),
  );
  expect(enabled).not.toContain('disabled=""');
});
