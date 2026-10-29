import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ENVIRONMENT_EXPIRY_DEFAULT_DAYS,
  environmentEndpointsSchema,
  environmentNameSchema,
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
 * an expiry no further than the install allows, and endpoints the Environment
 * serves on a port each. They never set or show who may open an Environment,
 * only how many may, so a prompt the agent reads cannot share it.
 */
export function registerEnvironmentTools(
  server: McpServer,
  deps: { environments: OwningAgentEnvironments },
): void {
  const envs = deps.environments;

  server.tool(
    "create_environment",
    "Create an Environment: a sandbox of your own that runs software for other people and agents to open — typically one per pull request, running its build. It is a vm machine on the platform's image with Docker, k3s and openrc, with no harness and no connections, and it sleeps when nobody uses it and is deleted at its expiry. Name its endpoints (`app` → 4444): each gets its own address, returned here as `url` once the install serves Environments; give those addresses to an app that needs its public URL (an OIDC issuer, a redirect URI). `start` is a command it runs at every boot, as a Startup Item (an openrc user service in ~/.config/rc inside it), e.g. `docker compose up` or a script that starts k3s and deploys. Deploy into it over SSH: `ssh env-<name>` reaches it over a link only you can open, and `docker save IMAGE | ssh env-<name> k3s ctr images import -` ships an image in. Who may open it is for people to decide, never you: your owner, your editors and the people they name on your page in the app, and anyone your owner adds to this one Environment there.",
    {
      name: environmentNameSchema.describe(
        "Unique among your Environments, e.g. pr-42.",
      ),
      endpoints: environmentEndpointsSchema.describe(
        "What it serves: [{name, port}], a name of lowercase letters and digits.",
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
      access: noAccessInput,
    },
    (args) =>
      run(async () => {
        refuseAccess(args.access);
        return json(
          await envs.create({
            name: args.name,
            endpoints: args.endpoints,
            ...(args.start ? { start: args.start } : {}),
            ...(args.storage ? { storage: args.storage } : {}),
            ...(args.expires ? { expiresAt: parseExpiry(args.expires)! } : {}),
          }),
        );
      }),
  );

  server.tool(
    "list_environments",
    "List your Environments: name, endpoints and their addresses, how many people may open each besides your owner, when they expire, and whether each runs or sleeps.",
    {},
    () => run(async () => json(await envs.list())),
  );

  server.tool(
    "update_environment",
    "Change one of your Environments: extend or shorten its expiry. Who may open it is not yours to change: only people share it, in the app.",
    {
      name: environmentNameSchema,
      expires: expiresInput,
      access: noAccessInput,
    },
    (args) =>
      run(async () => {
        refuseAccess(args.access);
        return json(
          await envs.update(args.name, {
            ...(args.expires ? { expiresAt: parseExpiry(args.expires)! } : {}),
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
