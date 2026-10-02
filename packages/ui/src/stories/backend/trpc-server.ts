import type { FakeServer } from "./socket";

type At<T, P extends string> = P extends `${infer H}.${infer Rest}`
  ? H extends keyof T
    ? At<T[H], Rest>
    : never
  : P extends keyof T
    ? T[P]
    : never;

type Proc<T> = T extends { query: (...a: infer A) => Promise<infer O> }
  ? { input: A[0]; output: O }
  : T extends { mutate: (...a: infer A) => Promise<infer O> }
    ? { input: A[0]; output: O }
    : never;

/** A typed answer for one procedure: a value, or a function of the input. */
export type Answer<C, P extends string> =
  | Proc<At<C, P>>["output"]
  | ((input: Proc<At<C, P>>["input"]) => Proc<At<C, P>>["output"]);

export type Output<C, P extends string> = Proc<At<C, P>>["output"];

export type Fixtures = Record<string, unknown>;

type Entry = readonly [string, unknown];

/** Joins fixture lists; a path claimed by two lists is a bug, so it throws. */
export function mergeFixtures(...lists: (readonly Entry[])[]): Fixtures {
  const out: Fixtures = {};
  for (const [path, answer] of lists.flat()) {
    if (path in out) throw new Error(`duplicate fixture for ${path}`);
    out[path] = answer;
  }
  return out;
}

/** Builds a fixture entry whose value is checked against the real router. */
export function answers<C>() {
  return <P extends string>(path: P, answer: Answer<C, P>) =>
    [path, answer] as const;
}

export class NotFound extends Error {}

interface Request {
  id: number | string;
  method: string;
  params?: { path: string; input?: unknown };
}

const missing = new Set<string>();

/** Speaks tRPC v11's WebSocket protocol, answering queries and mutations from
 *  `fixtures`. Subscriptions start and stay silent; unknown paths reply with
 *  a NOT_FOUND error so the UI shows its own error state instead of hanging. */
export function trpcServer(name: string, fixtures: () => Fixtures): FakeServer {
  return {
    onMessage(frame, send) {
      if (frame === "PING") return send("PONG");
      if (frame === "PONG") return;
      const parsed = JSON.parse(frame) as Request | Request[];
      for (const req of Array.isArray(parsed) ? parsed : [parsed]) {
        if (req.method === "connectionParams") continue;
        if (req.method === "subscription.stop") continue;
        const path = req.params?.path ?? "";
        if (req.method === "subscription") {
          send(JSON.stringify({ id: req.id, result: { type: "started" } }));
          continue;
        }
        const table = fixtures();
        const entry = table[path];
        if (entry === undefined) {
          if (!missing.has(`${name}:${path}`)) {
            missing.add(`${name}:${path}`);
            console.warn(`[storybook] no ${name} fixture for`, path);
          }
          send(error(req.id, path, "NOT_FOUND", 404));
          continue;
        }
        try {
          const data =
            typeof entry === "function"
              ? (entry as (i: unknown) => unknown)(req.params?.input)
              : entry;
          send(
            JSON.stringify({
              id: req.id,
              result: { type: "data", data: data ?? null },
            }),
          );
        } catch (e) {
          send(
            e instanceof NotFound
              ? error(req.id, path, "NOT_FOUND", 404)
              : error(req.id, path, "INTERNAL_SERVER_ERROR", 500),
          );
        }
      }
    },
  };
}

function error(id: Request["id"], path: string, code: string, status: number) {
  return JSON.stringify({
    id,
    error: {
      message: `${code} (${path})`,
      code: status === 404 ? -32004 : -32603,
      data: { code, httpStatus: status, path },
    },
  });
}
