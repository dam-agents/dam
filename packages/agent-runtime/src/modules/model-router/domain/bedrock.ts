import { Transform, type TransformCallback } from "node:stream";
import { createUsageScanner, type ModelUsage } from "./usage.js";

export const BEDROCK_TEMPLATE = "bedrock";
const BEDROCK_PREFIX = "/bedrock/";
const MODEL_CALL =
  /^\/model\/([^/]+)\/(invoke|invoke-with-response-stream|converse|converse-stream)$/;

export interface BedrockRoute {
  connectionId: string;
  path: string;
}

export interface BedrockModelCall {
  modelId: string;
  messages: boolean;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a harness process on a Bedrock Connection
 * runs in the harness's own Bedrock mode with the Model Router as its Bedrock
 * base URL, `/bedrock/<connection id>`, so the router knows the Connection
 * from the path and passes the call on unchanged. Bedrock names the model in
 * the path, and the invoke paths carry an Anthropic Messages body and its
 * events; the converse paths have a shape of their own.
 */
export function bedrockRouteOf(pathname: string): BedrockRoute | null {
  if (!pathname.startsWith(BEDROCK_PREFIX)) return null;
  const rest = pathname.slice(BEDROCK_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  return { connectionId: rest.slice(0, slash), path: rest.slice(slash) };
}

export function bedrockModelCallOf(path: string): BedrockModelCall | null {
  const match = MODEL_CALL.exec(path);
  if (!match) return null;
  return {
    modelId: decodeURIComponent(match[1]!),
    messages: match[2]!.startsWith("invoke"),
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the host a Bedrock call goes to: a call on a
 * model (`/model/...`, token counting included) to the region's runtime host,
 * anything else, such as the listing of inference profiles, to its
 * control-plane host, which the Connection names. The
 * gateway puts the key on both.
 */
export function bedrockRootOf(
  env: Record<string, string>,
  runtime: boolean,
): string | null {
  const region = env.AWS_REGION;
  if (!region) return null;
  return runtime
    ? `https://bedrock-runtime.${region}.amazonaws.com`
    : (env.AWS_ENDPOINT_URL_BEDROCK?.replace(/\/+$/, "") ??
        `https://bedrock.${region}.amazonaws.com`);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the router as a harness process's Bedrock
 * runtime endpoint: Claude Code reads its own variable, Pi's AWS SDK client
 * the standard one for the Bedrock Runtime service. The SDK keeps the path,
 * so either call names the Connection.
 */
export function bedrockRouterEnv(
  routerBaseUrl: string,
  connectionId: string,
): Record<string, string> {
  const url = `${routerBaseUrl}${BEDROCK_PREFIX}${connectionId}`;
  return {
    ANTHROPIC_BEDROCK_BASE_URL: url,
    AWS_ENDPOINT_URL_BEDROCK_RUNTIME: url,
  };
}

const PRELUDE_BYTES = 12;
const CRC_BYTES = 4;

export interface BedrockUsageScanner extends Transform {
  usage(): ModelUsage | null;
  completed(): boolean;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the usage of a Converse reply, or of a Converse
 * stream's metadata event: Bedrock counts the tokens read from and written to
 * the prompt cache apart from the other input, as Anthropic does.
 */
export function converseUsageOf(json: unknown): ModelUsage | null {
  const usage =
    json && typeof json === "object"
      ? (json as { usage?: Record<string, unknown> }).usage
      : undefined;
  if (!usage || typeof usage !== "object") return null;
  const n = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? v : 0;
  return {
    inputTokens: n(usage.inputTokens),
    outputTokens: n(usage.outputTokens),
    cacheReadTokens: n(usage.cacheReadInputTokens),
    cacheCreationTokens: n(usage.cacheWriteInputTokens),
  };
}

export function converseUsageOfBody(text: string): ModelUsage | null {
  try {
    return converseUsageOf(JSON.parse(text));
  } catch {
    return null;
  }
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: reads the usage of a streamed model call as its
 * bytes pass, unchanged. Bedrock streams AWS event-stream frames (a 12-byte
 * prelude naming the frame's and its headers' lengths, the headers, the
 * payload, a checksum). An invoke call's payload is JSON whose `bytes` field
 * is one Anthropic Messages event in base64, which the Messages usage scanner
 * reads as it reads Anthropic's own stream; a Converse call's payload is the
 * event itself, and its usage comes in the closing metadata event.
 */
export function createBedrockUsageScanner(
  messages = true,
): BedrockUsageScanner {
  const events = createUsageScanner("anthropic-messages");
  events.resume();
  let converse: ModelUsage | null = null;
  let pending = Buffer.alloc(0);
  const read = (): void => {
    while (pending.length >= PRELUDE_BYTES) {
      const total = pending.readUInt32BE(0);
      const headers = pending.readUInt32BE(4);
      if (total < PRELUDE_BYTES + CRC_BYTES || pending.length < total) return;
      const payload = pending.subarray(
        PRELUDE_BYTES + headers,
        total - CRC_BYTES,
      );
      pending = pending.subarray(total);
      try {
        const chunk = JSON.parse(payload.toString("utf8")) as {
          bytes?: unknown;
        };
        if (!messages) converse = converseUsageOf(chunk) ?? converse;
        else if (typeof chunk.bytes === "string")
          events.write(
            `data: ${Buffer.from(chunk.bytes, "base64").toString("utf8")}\n\n`,
          );
      } catch {
        continue;
      }
    }
  };
  const scanner = new Transform({
    transform(chunk: Buffer, _enc, done: TransformCallback) {
      pending = Buffer.concat([pending, chunk]);
      read();
      done(null, chunk);
    },
  }) as BedrockUsageScanner;
  scanner.usage = () => (messages ? events.usage() : converse);
  scanner.completed = () => (messages ? events.completed() : converse !== null);
  return scanner;
}
