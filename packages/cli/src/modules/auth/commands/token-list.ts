import { Command } from "commander";
import type { ConfigService } from "../../cli/index.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";
import { printTrpcError } from "../../shared/trpc/print.js";
import {
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
} from "../../shared/exit-codes.js";

export interface TokenListCommandDeps {
  configService: ConfigService;
  buildTrpc: (host: string) => TrpcClient;
}

export function buildTokenListCommand(deps: TokenListCommandDeps): Command {
  return new Command("list")
    .description(
      "List API keys owned by the current user (plaintext never shown)",
    )
    .option("--json", "emit raw JSON")
    .action(async (opts: { json?: boolean }) => {
      const resolved = await deps.configService.getResolved({});
      if (!resolved.ok) {
        process.stderr.write(
          "error: no server configured; pass `--server <url>` or run `dam config set server <url>`\n",
        );
        process.exit(EXIT_INVALID_INPUT);
      }

      const trpc = deps.buildTrpc(resolved.value.server);
      try {
        const keys = await trpc.apiKeys.list.query();
        if (opts.json) {
          process.stdout.write(`${JSON.stringify(keys)}\n`);
          return;
        }
        if (keys.length === 0) {
          process.stdout.write("(no api keys)\n");
          return;
        }
        for (const k of keys) {
          const binding = k.agentIds === "*" ? "*" : k.agentIds.join(",");
          const exp = k.expiresAt ? `exp=${k.expiresAt}` : "exp=never";
          const last = k.lastUsedAt ? `last=${k.lastUsedAt}` : "last=never";
          process.stdout.write(
            `${k.id}\t${k.name}\t[${k.scopes.join(",")}]\tagents=${binding}\t${exp}\t${last}\n`,
          );
        }
      } catch (err) {
        printTrpcError(err, resolved.value.server);
        process.exit(EXIT_RUNTIME_FAILURE);
      }
    });
}
