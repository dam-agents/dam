import { Command } from "commander";
import { ALL_SCOPES, scopeSchema, type Scope } from "api-server-api";
import type { ConfigService } from "../../cli/index.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";
import { printTrpcError } from "../../shared/trpc/print.js";
import {
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
} from "../../shared/exit-codes.js";

export interface TokenCreateCommandDeps {
  configService: ConfigService;
  buildTrpc: (host: string) => TrpcClient;
}

export function buildTokenCreateCommand(deps: TokenCreateCommandDeps): Command {
  return new Command("create")
    .description(
      "Mint a new API key. The plaintext token is printed once on stderr — copy it now, it cannot be recovered.",
    )
    .requiredOption("--name <name>", "human-readable label")
    .option(
      "--scope <scope...>",
      `permission scope (${ALL_SCOPES.join(" | ")}); repeatable`,
    )
    .option(
      "--agent <agent-id...>",
      "restrict to specific Agent IDs (repeatable); defaults to all owned agents",
    )
    .option(
      "--expires <iso>",
      "expiration timestamp in ISO 8601, e.g. 2026-12-31T00:00:00Z",
    )
    .option("--json", "emit the result as JSON (still warns on stderr)")
    .action(
      async (opts: {
        name: string;
        scope?: string[];
        agent?: string[];
        expires?: string;
        json?: boolean;
      }) => {
        const scopes = (opts.scope ?? ["agents:operate"]) as string[];
        const parsedScopes: Scope[] = [];
        for (const s of scopes) {
          const r = scopeSchema.safeParse(s);
          if (!r.success) {
            process.stderr.write(
              `error: unknown scope "${s}". Valid: ${ALL_SCOPES.join(", ")}\n`,
            );
            process.exit(EXIT_INVALID_INPUT);
          }
          parsedScopes.push(r.data);
        }

        const resolved = await deps.configService.getResolved({});
        if (!resolved.ok) {
          process.stderr.write(
            "error: no server configured; pass `--server <url>` or run `dam config set server <url>`\n",
          );
          process.exit(EXIT_INVALID_INPUT);
        }

        const trpc = deps.buildTrpc(resolved.value.server);
        try {
          const result = await trpc.apiKeys.create.mutate({
            name: opts.name,
            scopes: parsedScopes,
            agentIds: opts.agent && opts.agent.length > 0 ? opts.agent : "*",
            ...(opts.expires ? { expiresAt: opts.expires } : {}),
          });

          // Plaintext path is asymmetric on purpose:
          //   --json: token on stdout inside the JSON payload, for scripts.
          //   interactive: token on STDERR alongside the warning, so a
          //     casual `dam auth token create … > file` doesn't capture the
          //     secret into a file the user didn't realize would hold it.
          if (opts.json) {
            process.stdout.write(
              `${JSON.stringify({ ...result.key, plaintext: result.plaintext })}\n`,
            );
          } else {
            process.stderr.write(
              "⚠ Copy this token now. It will never be shown again.\n",
            );
            process.stderr.write(`${result.plaintext}\n`);
            process.stderr.write(`id: ${result.key.id}\n`);
            process.stderr.write(`name: ${result.key.name}\n`);
            process.stderr.write(`scopes: ${result.key.scopes.join(", ")}\n`);
            const binding =
              result.key.agentIds === "*"
                ? "all owned agents"
                : result.key.agentIds.join(", ");
            process.stderr.write(`agents: ${binding}\n`);
            if (result.key.expiresAt)
              process.stderr.write(`expires: ${result.key.expiresAt}\n`);
          }
        } catch (err) {
          printTrpcError(err, resolved.value.server);
          process.exit(EXIT_RUNTIME_FAILURE);
        }
      },
    );
}
