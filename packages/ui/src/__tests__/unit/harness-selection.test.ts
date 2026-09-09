// TEST_OVERVIEW: a setup form's harness selection is persisted in sessionStorage
// TEST_OVERVIEW: while the catalogue is server-owned, so the two must be reconciled
// TEST_OVERVIEW: whenever the catalogue arrives: a stale id is replaced (or cleared
// TEST_OVERVIEW: when a custom image legitimately leaves it empty), an empty selection
// TEST_OVERVIEW: gets the default, and a valid selection is never touched.
import { describe, expect, test } from "vitest";

import {
  defaultHarnessId,
  reconcileHarnessSelection,
} from "../../modules/sandboxes/lib/image-catalogue.js";
import type { TemplateView } from "../../types.js";

function harness(id: string): TemplateView {
  return {
    id,
    name: id,
    image: `quay.io/x/${id}:latest`,
    category: "harness",
    experimental: false,
    vm: false,
  };
}

const CATALOGUE = [harness("codex"), harness("claude-code"), harness("bob")];

describe("defaultHarnessId", () => {
  test("prefers claude-code, else the first harness, else nothing", () => {
    expect(defaultHarnessId(CATALOGUE)).toBe("claude-code");
    expect(defaultHarnessId([harness("codex"), harness("bob")])).toBe("codex");
    expect(defaultHarnessId([])).toBeNull();
  });
});

describe("reconcileHarnessSelection", () => {
  test("leaves a selection that is in the catalogue alone", () => {
    expect(
      reconcileHarnessSelection(CATALOGUE, "bob", { allowNone: false }),
    ).toBeNull();
  });

  test("replaces a stale selection with the default", () => {
    expect(
      reconcileHarnessSelection(CATALOGUE, "retired", { allowNone: false }),
    ).toEqual({ templateId: "claude-code" });
  });

  test("clears a stale selection when a custom image makes none legitimate", () => {
    expect(
      reconcileHarnessSelection(CATALOGUE, "retired", { allowNone: true }),
    ).toEqual({ templateId: null });
  });

  test("fills an empty selection with the default unless none is allowed", () => {
    expect(
      reconcileHarnessSelection(CATALOGUE, null, { allowNone: false }),
    ).toEqual({ templateId: "claude-code" });
    expect(
      reconcileHarnessSelection(CATALOGUE, null, { allowNone: true }),
    ).toBeNull();
  });

  test("does nothing against an empty catalogue with nothing selected", () => {
    expect(
      reconcileHarnessSelection([], null, { allowNone: false }),
    ).toBeNull();
    expect(reconcileHarnessSelection([], "x", { allowNone: false })).toEqual({
      templateId: null,
    });
  });
});
