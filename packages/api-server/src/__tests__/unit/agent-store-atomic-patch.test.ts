// TEST_OVERVIEW: every patch of the agent record used to be a read, a merge in JavaScript and a write. Kubernetes refused the write when the version had moved; Postgres does not, so two overlapping patches of one column each merged onto the base they read and the later one carried the earlier away. The writers sit on different nodes — an activity stamp where the browser landed, a session flag elsewhere, the scheduler's placement complaints against the supervisor's observations — so losing one silently hibernates an agent somebody is talking to, or drops the stop nobody sees not happen. What these assert is the shape that makes that impossible: the merge is in the statement, so there is no base to read and nothing to lose.
import { describe, expect, it } from "vitest";
import type { Db } from "db";
import { createAgentStore } from "../../modules/agents/infrastructure/agent-store.js";

interface Chunk {
  value?: unknown;
  queryChunks?: Chunk[];
  name?: string;
  columnType?: string;
}

/** TEST_SCENARIO: flattens a drizzle SQL fragment to the operators, column and bound values it will send, which is the only part of it that decides whether the merge happens in the database rather than in this process. */
function render(node: unknown): string {
  const chunk = node as Chunk;
  if (Array.isArray(chunk.queryChunks))
    return chunk.queryChunks.map(render).join("");
  if (Array.isArray(chunk.value)) return chunk.value.join("");
  if (chunk.columnType !== undefined) return `"${String(chunk.name)}"`;
  return String(node);
}

function fakeDb() {
  const ops: string[] = [];
  let set: Record<string, unknown> = {};
  const chain = (result: unknown[]): unknown => {
    const self: Record<string, unknown> = {};
    for (const m of ["from", "where", "limit", "returning", "values"]) {
      self[m] = () => self;
    }
    self.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(result).then(resolve);
    return self;
  };
  const row = {
    id: "a1",
    owner: "o",
    templateId: null,
    annotations: {},
    spec: {},
    status: {},
    assignedNode: null,
    lastNode: null,
  };
  const db = {
    select: () => {
      ops.push("select");
      return chain([row]);
    },
    update: () => {
      ops.push("update");
      return {
        set: (values: Record<string, unknown>) => {
          set = values;
          return chain([row]);
        },
      };
    },
    insert: () => chain([row]),
    delete: () => chain([row]),
  };
  return { db: db as unknown as Db, ops, set: () => set };
}

describe("patching one column of the agent record", () => {
  // TEST_SCENARIO: a read before the write is the whole defect. If one reappears, the merge is happening in this process again and two nodes patching the same column will lose one of the two.
  it.each([
    [
      "annotations",
      (s: ReturnType<typeof createAgentStore>) =>
        s.patchAnnotations("a1", { "x/active": "true" }),
    ],
    [
      "status",
      (s: ReturnType<typeof createAgentStore>) =>
        s.writeStatus("a1", { ready: true }),
    ],
    [
      "spec",
      (s: ReturnType<typeof createAgentStore>) =>
        s.patchSpec("a1", { name: "n" }),
    ],
  ])("writes %s without reading it first", async (_column, patch) => {
    const { db, ops } = fakeDb();
    await patch(createAgentStore(db));
    expect(ops).toEqual(["update"]);
  });

  it("merges onto the stored column rather than onto a copy of it", async () => {
    const { db, set } = fakeDb();
    await createAgentStore(db).patchAnnotations("a1", { "x/active": "true" });
    expect(render(set().annotations)).toBe(
      '("annotations" || {"x/active":"true"}::jsonb)',
    );
  });

  // TEST_SCENARIO: a null means "unset this", which `||` would write as a null *value* — and a spec field holding null is not the same as one that is absent: `hibernationTimeout` reaching the parser as null throws where an absent one falls back to the install default.
  it("removes a key a null asks it to unset", async () => {
    const { db, set } = fakeDb();
    await createAgentStore(db).patchSpec("a1", {
      name: "n",
      hibernationTimeout: null,
    });
    expect(render(set().spec)).toBe(
      '("spec" || {"name":"n"}::jsonb) - hibernationTimeout::text',
    );
  });
});
