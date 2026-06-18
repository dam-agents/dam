import { Command } from "commander";
import type { ConfigService } from "../../cli/index.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";
import { printTrpcError } from "../../shared/trpc/print.js";
import {
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
} from "../../shared/exit-codes.js";

export interface TokenRevokeCommandDeps {
  configService: ConfigService;
  buildTrpc: (host: string) => TrpcClient;
}

export function buildTokenRevokeCommand(deps: TokenRevokeCommandDeps): Command {
  return new Command("revoke")
    .description(
      "Revoke an API key by ID. The key is immediately rejected on the next request.",
    )
    .argument("<id>", "API key ID (e.g. key-abcdef12)")
    .action(async (id: string) => {
      const resolved = await deps.configService.getResolved({});
      if (!resolved.ok) {
        process.stderr.write(
          "error: no server configured; pass `--server <url>` or run `dam config set server <url>`\n",
        );
        process.exit(EXIT_INVALID_INPUT);
      }

      const trpc = deps.buildTrpc(resolved.value.server);
      try {
        await trpc.apiKeys.revoke.mutate({ id });
        process.stdout.write(`✓ Revoked ${id}\n`);
      } catch (err) {
        printTrpcError(err, resolved.value.server);
        process.exit(EXIT_RUNTIME_FAILURE);
      }
    });
}
