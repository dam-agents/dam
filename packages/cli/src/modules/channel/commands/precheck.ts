import { ChannelType } from "api-server-api";
import { printServiceError } from "../../agent/commands/errors.js";
import {
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
} from "../../shared/exit-codes.js";
import type { ChannelService } from "../services/channel-service.js";

// Mirrors the server's PRECONDITION_FAILED messages so the early exit reads
// the same as the route would if the precheck were skipped.
const UNAVAILABLE_MESSAGE: Record<ChannelType, string> = {
  [ChannelType.Slack]: "Slack app token not configured",
  [ChannelType.Telegram]: "Telegram channel not enabled",
};

/**
 * Refuse a connect when the operator didn't enable `provider` on this host,
 * exiting `EXIT_INVALID_INPUT` (2) with the operator-facing hint — rather than
 * letting the mutation round-trip and bounce back PRECONDITION_FAILED.
 */
export async function ensureProviderAvailable(
  svc: ChannelService,
  provider: ChannelType,
  host: string,
): Promise<void> {
  const res = await svc.available();
  if (!res.ok) {
    printServiceError(res.error, host);
    process.exit(EXIT_RUNTIME_FAILURE);
  }
  if (!res.value[provider]) {
    process.stderr.write(`error: ${UNAVAILABLE_MESSAGE[provider]}\n`);
    process.exit(EXIT_INVALID_INPUT);
  }
}
