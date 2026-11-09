import { Readable } from "node:stream";
import {
  leaseEnvOf,
  type RuntimeEnvState,
} from "../../runtime-channel/infrastructure/env-state-store.js";
import type { ModelRouterBinding } from "../../runtime-channel/manifest.js";
import { rewriteBobProfile } from "../domain/bob-profile.js";
import {
  keepHeaders,
  REQ_DROP,
  RES_DROP,
  type RouterExtension,
} from "./model-router.js";

export const BOB_TEMPLATE = "bob";
const PROFILE_PATH = "/admin/v1/profile";
const MODEL_NAMESPACE = "/inference/";
const LOGGED_BODY_MAX = 400;

export interface BobGatewayDeps {
  envState: () => RuntimeEnvState;
  harnesses: Readonly<Record<string, ModelRouterBinding | undefined>>;
  fetchImpl?: typeof globalThis.fetch;
  log: (msg: string) => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Bob sends every call to one base URL, the
 * router, and besides model calls and the model list it reads its profile
 * and team budget from the admin API and its docs search from an MCP server
 * under `/rag`. A call of the Bob harness the router has no route for goes
 * on, as sent, to the Bob Shell Connection's own gateway with that
 * Connection's credential placeholder, which the credential gateway swaps for
 * the key; the gateway's meter classes none of these paths as billable, and
 * the router records no call for them. A path under Bob's `/inference`
 * namespace is a model call the router does not serve and stays its 404, so
 * no model-shaped call leaves unstamped and unrecorded. The profile is the
 * one reply the router rewrites, so Bob stays on the router and runs on the
 * pinned team and instance. Without a Bob Shell Connection nothing is
 * forwarded; with several, the first granted one answers, which the rival
 * rule on Connections of one template keeps from arising.
 */
export function createBobGatewayPassthrough(
  deps: BobGatewayDeps,
): RouterExtension {
  const doFetch = deps.fetchImpl ?? globalThis.fetch;
  return {
    name: "bob-gateway",
    async handle({ req, res, path, harness }) {
      if (deps.harnesses[harness]?.bobGateway !== true) return false;
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname.startsWith(MODEL_NAMESPACE)) return false;
      const state = deps.envState();
      const layer = state.providers.find(
        (l) => l.template === BOB_TEMPLATE && !!l.env.BOB_DEFAULT_GATEWAY_URL,
      );
      if (!layer) return false;
      /* UNIT_BOUNDARY_DESCRIPTION: a pin is read on the ladder a harness process reads its env on, the harness layer over the agent's own env over the Connection's setting, so chat sessions and a terminal's flags resolve one team and instance and an override in Configure Agent → Env wins for both. */
      const lease = leaseEnvOf(state, { harness, provider: null });
      const pin = (name: string): string | null =>
        lease[name] ?? layer.env[name] ?? null;
      const method = req.method ?? "GET";
      const where = `bob gateway ${method} ${url.pathname}`;
      const target = `${layer.env.BOB_DEFAULT_GATEWAY_URL!.replace(/\/+$/, "")}${url.pathname}${url.search}`;
      const headers = keepHeaders(Object.entries(req.headers), REQ_DROP);
      if (layer.env.BOBSHELL_API_KEY)
        headers.authorization = `Apikey ${layer.env.BOBSHELL_API_KEY}`;
      const ac = new AbortController();
      res.on("close", () => {
        if (!res.writableEnded) ac.abort();
      });
      const gone = () => ac.signal.aborted || res.destroyed;
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const body = Buffer.concat(chunks);
        const upstream = await doFetch(target, {
          method,
          headers,
          ...(method !== "GET" && method !== "HEAD" && { body }),
          signal: ac.signal,
          redirect: "manual",
        });
        const resHeaders = keepHeaders([...upstream.headers], RES_DROP);
        const streamed = (upstream.headers.get("content-type") ?? "").includes(
          "text/event-stream",
        );
        if (upstream.status >= 400 && !streamed) {
          const text = await upstream.text();
          deps.log(
            `[model-router] ${where} → ${upstream.status}: ${text.replace(/\s+/g, " ").slice(0, LOGGED_BODY_MAX)}`,
          );
          res.writeHead(upstream.status, resHeaders).end(text);
          return true;
        }
        if (method === "GET" && path === PROFILE_PATH && upstream.ok) {
          const text = await upstream.text();
          res
            .writeHead(upstream.status, {
              ...resHeaders,
              "content-type": "application/json",
            })
            .end(
              rewriteBobProfile(text, {
                teamId: pin("BOB_TEAM_ID"),
                instanceId: pin("BOB_INSTANCE_ID"),
              }),
            );
          return true;
        }
        res.writeHead(upstream.status, resHeaders);
        if (!upstream.body) {
          res.end();
          return true;
        }
        const source = Readable.fromWeb(upstream.body as never);
        source.on("error", () => res.destroy());
        source.pipe(res);
        return true;
      } catch (err) {
        if (gone()) return true;
        const reason =
          (err as { cause?: Error }).cause?.message ?? (err as Error).message;
        deps.log(`[model-router] ${where}: unreachable (${reason})`);
        if (res.headersSent) res.destroy();
        else
          res.writeHead(502, { "content-type": "application/json" }).end(
            JSON.stringify({
              error: {
                message: `model-router: Bob's gateway is unreachable: ${reason}`,
              },
            }),
          );
        return true;
      }
    },
  };
}
