import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { uiEventsInputSchema } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  elementOf,
  FIXED_TESTID_PREFIXES,
  ID_TESTID_PREFIXES,
} from "../../modules/usage/lib/ui-elements.js";
import { createUiRecorder } from "../../modules/usage/lib/ui-recorder.js";

// TEST_OVERVIEW: the browser records views, clicks on test ids and friction signals, and sends them as batches the api-server accepts.
// TEST_OVERVIEW: An element name never carries an id or a name a user typed.

const SRC = join(import.meta.dirname, "../..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return entry.name === "__tests__" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("UI telemetry", () => {
  // TEST_SCENARIO: three fast clicks on one element and a quick return to the page the user came from are friction; the batch must pass the server's input schema.
  it("turns clicks and navigation into signals the server accepts", () => {
    let now = 0;
    const rec = createUiRecorder(() => now);
    rec.routeChanged("/");
    now = 1_000;
    rec.routeChanged("/settings/connections");
    for (const t of [1_100, 1_300, 1_500]) {
      now = t;
      rec.click("catalog-add-:id");
    }
    now = 3_000;
    rec.routeChanged("/");
    now = 3_500;

    const events = rec.drain(50);
    expect(
      events.map((e) => (e.kind === "signal" ? e.signal : e.kind)),
    ).toEqual([
      "view",
      "action",
      "action",
      "action",
      "rage_click",
      "view",
      "nav_bounce",
    ]);
    expect(events[5]).toMatchObject({
      kind: "view",
      route: "/settings/connections",
      dwellMs: 2_000,
      ageMs: 2_500,
    });
    expect(
      uiEventsInputSchema.safeParse({
        tab: crypto.randomUUID(),
        build: "1.2.0",
        events,
      }).success,
    ).toBe(true);
  });

  // TEST_SCENARIO: a test id built from a template can end in a connection id, a repository or a GitHub login, so every template prefix must be known as id-carrying or fixed.
  it("knows every templated test id prefix and hides ids behind it", () => {
    const templated = new Set(
      sourceFiles(SRC).flatMap((file) =>
        [
          ...readFileSync(file, "utf8").matchAll(
            /(?:data-testid|testId)=\{?`([a-z0-9-]+-)\$\{/g,
          ),
        ].map((m) => m[1]!),
      ),
    );
    const known = new Set<string>([
      ...ID_TESTID_PREFIXES,
      ...FIXED_TESTID_PREFIXES,
    ]);

    expect([...templated].filter((prefix) => !known.has(prefix))).toEqual([]);
    expect(elementOf("github-user-account-jdoe")).toBe(
      "github-user-account-:id",
    );
    expect(elementOf("catalog-connection-account-c0ffee12")).toBe(
      "catalog-connection-account-:id",
    );
    expect(elementOf("side-panel-tab-files")).toBe("side-panel-tab-files");
  });
});
