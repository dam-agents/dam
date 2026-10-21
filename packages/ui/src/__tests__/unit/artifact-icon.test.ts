// TEST_OVERVIEW: An artifact is drawn with the document-attachment icon in the new layout, wherever it appears, and with the folders icon in the current layout.
import { DocumentAttachment, Folders } from "@carbon/icons-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { ArtifactIcon } from "../../modules/artifacts/lib/artifact-icon.js";

const layout = vi.hoisted(() => ({ isNew: false }));
vi.mock("../../modules/features/hooks/use-new-layout.js", () => ({
  useNewLayout: () => layout.isNew,
}));

function svg(icon: typeof ArtifactIcon) {
  return renderToStaticMarkup(createElement(icon, { size: 16 }));
}

// TEST_SCENARIO: the flag alone picks the icon, so every surface that shows ArtifactIcon follows it.
it("follows the new-layout flag", () => {
  layout.isNew = true;
  expect(svg(ArtifactIcon)).toBe(svg(DocumentAttachment));
  layout.isNew = false;
  expect(svg(ArtifactIcon)).toBe(svg(Folders));
});
