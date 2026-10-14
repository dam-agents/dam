// TEST_OVERVIEW: A2UI v1.0 in agent chat text — blocks split out of markdown, surfaces replay across the Session Transcript, catalog functions evaluate against the data model, and a streaming block renders the components that are already complete.
import { describe, expect, test } from "vitest";

import { BASIC_CATALOG_ID } from "../../modules/a2ui/lib/catalogs.js";
import {
  buildConversation,
  renderedNodeCount,
} from "../../modules/a2ui/lib/conversation.js";
import { evaluate } from "../../modules/a2ui/lib/functions/evaluate.js";
import { splitA2uiBlocks } from "../../modules/a2ui/lib/split-blocks.js";
import { failedChecks } from "../../modules/a2ui/lib/validation.js";

const CREATE = JSON.stringify([
  {
    version: "v1.0",
    createSurface: {
      surfaceId: "pick",
      catalogId: BASIC_CATALOG_ID,
      components: [
        { id: "root", component: "Column", children: ["title"] },
        { id: "title", component: "Text", text: { "@path": "/title" } },
      ],
      dataModel: { title: "Pick changes" },
    },
  },
]);

const UPDATE = JSON.stringify([
  {
    version: "v1.0",
    updateDataModel: { surfaceId: "pick", path: "/title", value: "Applied" },
  },
  {
    version: "v1.0",
    updateComponents: {
      surfaceId: "pick",
      components: [{ id: "extra", component: "Card", child: "gone" }],
    },
  },
]);

function ctx(model: unknown, indexes: number[] = []) {
  return {
    model,
    scope: indexes.length ? `/items/${indexes[0]}` : "",
    indexes,
    catalogId: BASIC_CATALOG_ID,
    userActivation: false,
  };
}

describe("A2UI v1.0", () => {
  // TEST_SCENARIO: a block opens only at the start of a line, so a tag the agent mentions in prose stays text; the last block of a streaming reply has no closing tag yet.
  test("splits text around blocks and marks an unclosed block as streaming", () => {
    expect(
      splitA2uiBlocks(
        `Pick one:\n<a2ui-json>${CREATE}</a2ui-json>\nA \`<a2ui-json>\` mention.\n<a2ui-json>[`,
      ),
    ).toEqual([
      { kind: "markdown", text: "Pick one:\n" },
      { kind: "a2ui", source: CREATE, closed: true },
      { kind: "markdown", text: "\nA `<a2ui-json>` mention.\n" },
      { kind: "a2ui", source: "[", closed: false },
    ]);
  });

  // TEST_SCENARIO: a later agent message updates the surface an earlier message created, so the form re-renders in place and the later block only reports what it touched and what was wrong.
  test("replays a later update into the surface an earlier message created", () => {
    const { surfaces, blocks } = buildConversation([
      { key: "a", messageId: "m1", source: CREATE, closed: true },
      { key: "b", messageId: "m2", source: UPDATE, closed: true },
    ]);
    const surface = surfaces.get("pick");
    expect(surface?.dataModel).toEqual({ title: "Applied" });
    expect(surface?.lastTouchMessageId).toBe("m2");
    expect(blocks.get("a")?.owned).toEqual(["pick"]);
    expect(blocks.get("b")?.touched).toEqual(["pick"]);
    expect(blocks.get("b")?.errors.map((error) => error.message)).toEqual([
      'Component "extra" refers to missing component "gone".',
    ]);
  });

  test("evaluates catalog functions, @index and checks", () => {
    const model = { items: [{ n: 1234.5 }, { n: 2 }], email: "nope" };
    expect(
      evaluate(
        {
          "@call": "formatString",
          args: {
            value:
              "#${@index(offset: 1)} ${formatNumber(value: ${n}, decimals: 1, grouping: false)}",
          },
        },
        ctx(model, [0]),
      ),
    ).toBe("#1 1234.5");
    expect(
      failedChecks(
        [
          {
            condition: {
              "@call": "email",
              args: { value: { "@path": "/email" } },
            },
            message: "Use a work email",
          },
        ],
        ctx(model),
      ),
    ).toEqual([{ message: "Use a work email", severity: "error" }]);
  });

  // TEST_SCENARIO: while the agent streams, the surface holds only the components that are already complete and reports nothing; a finished message that never closed the block reports it.
  test("renders the complete prefix of a streaming block and reports it once the message ends", () => {
    const partial =
      '[{"version":"v1.0","createSurface":{"surfaceId":"s","catalogId":"' +
      BASIC_CATALOG_ID +
      '","components":[{"id":"root","component":"Text","text":"Hi"},{"id":"b","component":"Bu';
    const streaming = buildConversation([
      { key: "a", messageId: "m1", source: partial, closed: false },
    ]);
    expect([...(streaming.surfaces.get("s")?.components.keys() ?? [])]).toEqual(
      ["root"],
    );
    expect(streaming.blocks.get("a")?.errors).toEqual([]);
    const finished = buildConversation([
      { key: "a", messageId: "m1", source: partial, closed: true },
    ]);
    expect(finished.blocks.get("a")?.errors.map((error) => error.code)).toEqual(
      ["VALIDATION_FAILED"],
    );
  });

  // TEST_SCENARIO: an agent that shares one child id between parents gets an error, and the node count stops at its limit instead of following the exponential fan-out.
  test("rejects a shared child and caps the rendered node count", () => {
    const components = [
      { id: "root", component: "Row", children: ["a", "a"] },
      ...Array.from({ length: 30 }, (_, index) => ({
        id: index === 0 ? "a" : `a${index}`,
        component: "Row",
        children: index === 29 ? [] : [`a${index + 1}`, `a${index + 1}`],
      })),
    ];
    const source = JSON.stringify([
      {
        version: "v1.0",
        createSurface: {
          surfaceId: "fan",
          catalogId: BASIC_CATALOG_ID,
          components,
        },
      },
    ]);
    const { surfaces, blocks } = buildConversation([
      { key: "a", messageId: "m1", source, closed: true },
    ]);
    expect(blocks.get("a")?.errors.map((error) => error.message)).toContain(
      'Component "a" has more than one parent; each component appears once in the tree.',
    );
    const surface = surfaces.get("fan");
    expect(surface && renderedNodeCount(surface, {}, 100)).toBe(101);
  });
});
