import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ENVIRONMENT_EXPIRY_DEFAULT_DAYS,
  environmentEndpointNameSchema,
  environmentEndpointsSchema,
  environmentNameSchema,
  environmentReadyPathSchema,
} from "api-server-api";
import { json, run } from "../../core/mcp-tool-result.js";
import type { OwningAgentEnvironments } from "./services/environments-service.js";

const expiresInput = z
  .string()
  .optional()
  .describe(
    `When the platform deletes the Environment: an ISO date-time, or a number of hours or days ("48h", "7d"). Default ${ENVIRONMENT_EXPIRY_DEFAULT_DAYS} days; capped at the install's maximum.`,
  );

export function parseExpiry(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const relative = /^(\d+)\s*([hd])$/.exec(value.trim());
  const at = relative
    ? new Date(
        Date.now() +
          Number(relative[1]) * (relative[2] === "d" ? 24 : 1) * 3_600_000,
      )
    : new Date(value);
  if (Number.isNaN(at.getTime()))
    throw new Error(
      `expires: ${value} is not a date or a number of hours or days`,
    );
  return at;
}

function idleTimeoutInput(limits: OwningAgentEnvironments["idleTimeout"]) {
  return z
    .string()
    .optional()
    .describe(
      `How long it may sit idle before it sleeps: a number of minutes, hours or days ("90m", "4h"). Default ${limits.defaultMin} minutes; at most ${limits.maxMin} minutes, and a longer one is cut to that. It always sleeps in the end: 0 or "never" is refused, and the platform may still put it to sleep early when its machine's memory is needed.`,
    );
}

// UNIT_BOUNDARY_DESCRIPTION: reads an idle timeout as an agent writes it, in the units `expires` takes plus minutes, into whole minutes. A word or a bare number is refused here, so "never" or "off" cannot read as no timeout; zero parses and is refused by the service, with the reason.
export function parseIdleTimeout(
  value: string | undefined,
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = /^(\d+)\s*([mhd])$/.exec(value.trim());
  if (!parsed)
    throw new Error(
      `idle_timeout: ${value} is not a number of minutes, hours or days ("90m", "4h"); an Environment always sleeps when nobody uses it`,
    );
  const minutes =
    Number(parsed[1]) * (parsed[2] === "d" ? 1440 : parsed[2] === "h" ? 60 : 1);
  if (!Number.isSafeInteger(minutes))
    throw new Error(`idle_timeout: ${value} is too long`);
  return minutes;
}

const noAccessInput = z
  .unknown()
  .optional()
  .describe(
    "No longer accepted: only people decide who may open an Environment, in the app.",
  );

// UNIT_BOUNDARY_DESCRIPTION: the refusal of the `access` an agent passed before only people decided who may open an Environment; refused rather than dropped, so the agent never believes it narrowed one.
function refuseAccess(access: unknown): void {
  if (access !== undefined)
    throw new Error(
      "access: only a person can share an Environment, in the app — your owner in its Share dialog, or your owner and editors on your page. Tell them whom to add.",
    );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The platform MCP tools an owning vm Agent uses to
 * manage its own Environments, offered only while its owner has the
 * environments feature on. They act on the calling Agent's Environments
 * alone, found by name, and take the same rules as the app: a cap per agent,
 * an expiry and an idle timeout no further than the install allows, and endpoints the Environment
 * serves on a port each. They never set or show who may open an Environment,
 * only how many may, so a prompt the agent reads cannot share it.
 */
export function registerEnvironmentTools(
  server: McpServer,
  deps: { environments: OwningAgentEnvironments },
): void {
  const envs = deps.environments;
  if (!deps.environments.manage) {
    registerSharedEnvironmentsTool(server, envs);
    return;
  }
  const idleTimeout = idleTimeoutInput(envs.idleTimeout);

  server.tool(
    "create_environment",
    "Create an Environment: a sandbox of your own that runs software for other people and agents to open — typically one per pull request, running its build. It is a vm machine on the platform's image with Docker, k3s and openrc, with no harness and no connections, and it sleeps when nobody uses it for `idle_timeout` and is deleted at its expiry. Name its endpoints (`app` → 4444): each gets its own address, returned here as `url` once the install serves Environments; give those addresses to an app that needs its public URL (an OIDC issuer, a redirect URI). `start` is a command it runs at every boot, as a Startup Item (an openrc user service in ~/.config/rc inside it), e.g. `docker compose up` or a script that starts k3s and deploys. Deploy into it over SSH: `ssh env-<name>` reaches it over a link only you can open, and `docker save IMAGE | ssh env-<name> k3s ctr images import -` ships an image in. Who may open it is for people to decide, never you: your owner, your editors and the people they name on your page in the app, and anyone your owner adds to this one Environment there.",
    {
      name: environmentNameSchema.describe(
        "Unique among your Environments, e.g. pr-42.",
      ),
      endpoints: environmentEndpointsSchema.describe(
        "What it serves: [{name, port, ready?}], a name of lowercase letters and digits. `ready` is a path that answers 2xx or 3xx once the app is up, e.g. /healthz; until it does, a visitor sees a loading page. Without it, the endpoint is ready once its port answers.",
      ),
      start: z
        .string()
        .max(4000)
        .optional()
        .describe("A shell command it runs in ~/work at every boot."),
      storage: z
        .string()
        .regex(/^\d+Gi$/)
        .optional()
        .describe("Disk size, e.g. 40Gi; the install's default otherwise."),
      expires: expiresInput,
      idle_timeout: idleTimeout,
      access: noAccessInput,
    },
    (args) =>
      run(async () => {
        refuseAccess(args.access);
        const idleTimeoutMin = parseIdleTimeout(args.idle_timeout);
        return json(
          await envs.create({
            name: args.name,
            endpoints: args.endpoints,
            ...(args.start ? { start: args.start } : {}),
            ...(args.storage ? { storage: args.storage } : {}),
            ...(args.expires ? { expiresAt: parseExpiry(args.expires)! } : {}),
            ...(idleTimeoutMin !== undefined ? { idleTimeoutMin } : {}),
          }),
        );
      }),
  );

  server.tool(
    "list_environments",
    "List your Environments — name, endpoints and their addresses, how many people may open each besides your owner, when they expire, how long each may sit idle before it sleeps (`idleTimeoutMin`), and whether each runs or sleeps — and after them the Environments other agents' owners shared with you, each marked `sharedWithYou: true`, with whose agent it is and its addresses. Open a shared one at its addresses, as any visitor does; you cannot change, wake, delete or SSH into it.",
    {},
    () =>
      run(async () => json([...(await envs.list()), ...(await envs.shared())])),
  );

  server.tool(
    "update_environment",
    "Change one of your Environments: extend or shorten its expiry, change how long it may sit idle before it sleeps, or set its endpoints' readiness paths. Who may open it is not yours to change: only people share it, in the app.",
    {
      name: environmentNameSchema,
      expires: expiresInput,
      idle_timeout: idleTimeout,
      ready: z
        .record(
          environmentEndpointNameSchema,
          environmentReadyPathSchema.nullable(),
        )
        .optional()
        .describe(
          'Readiness paths by endpoint name, e.g. {"app": "/healthz"}: a visitor sees a loading page until the path answers 2xx or 3xx. null removes one, so the endpoint is ready once its port answers.',
        ),
      access: noAccessInput,
    },
    (args) =>
      run(async () => {
        refuseAccess(args.access);
        const idleTimeoutMin = parseIdleTimeout(args.idle_timeout);
        return json(
          await envs.update(args.name, {
            ...(args.expires ? { expiresAt: parseExpiry(args.expires)! } : {}),
            ...(idleTimeoutMin !== undefined ? { idleTimeoutMin } : {}),
            ...(args.ready ? { ready: args.ready } : {}),
          }),
        );
      }),
  );

  server.tool(
    "wake_environment",
    "Wake one of your Environments that sleeps, so you can reach it over SSH. `ssh env-<name>` does this itself; it is here for a script that waits on the Environment some other way.",
    { name: environmentNameSchema },
    (args) =>
      run(async () => {
        await envs.wake(args.name);
        return json({ waking: args.name });
      }),
  );

  server.tool(
    "delete_environment",
    "Delete one of your Environments now, with its disk, e.g. once its pull request merged.",
    { name: environmentNameSchema },
    (args) =>
      run(async () => {
        await envs.delete(args.name);
        return json({ deleted: args.name });
      }),
  );
}

// UNIT_BOUNDARY_DESCRIPTION: the one tool an Agent whose owner does not have Environments gets: the Environments other agents' owners shared with it, so a listed agent finds them whatever its own owner turned on.
function registerSharedEnvironmentsTool(
  server: McpServer,
  envs: Pick<OwningAgentEnvironments, "shared">,
): void {
  server.tool(
    "list_environments",
    "List the Environments other agents' owners shared with you, each marked `sharedWithYou: true`, with whose agent it is and its addresses. Open one at its addresses, as any visitor does; you cannot change, wake, delete or SSH into it.",
    {},
    () => run(async () => json(await envs.shared())),
  );
}
