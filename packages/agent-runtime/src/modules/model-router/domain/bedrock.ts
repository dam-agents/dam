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
 * UNIT_BOUNDARY_DESCRIPTION: a Claude Code process on a Bedrock Connection
 * runs in Claude Code's own Bedrock mode with the Model Router as its Bedrock
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

export function bedrockRouterEnv(
  routerBaseUrl: string,
  connectionId: string,
): Record<string, string> {
  return {
    ANTHROPIC_BEDROCK_BASE_URL: `${routerBaseUrl}${BEDROCK_PREFIX}${connectionId}`,
  };
}

const PRELUDE_BYTES = 12;
const CRC_BYTES = 4;

export interface BedrockUsageScanner extends Transform {
  usage(): ModelUsage | null;
  completed(): boolean;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: reads the usage of a streamed invoke call as its
 * bytes pass, unchanged. Bedrock streams AWS event-stream frames (a 12-byte
 * prelude naming the frame's and its headers' lengths, the headers, the
 * payload, a checksum); each chunk's payload is JSON whose `bytes` field is
 * one Anthropic Messages event in base64, which the Messages usage scanner
 * reads as it reads Anthropic's own stream.
 */
export function createBedrockUsageScanner(): BedrockUsageScanner {
  const events = createUsageScanner("anthropic-messages");
  events.resume();
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
        if (typeof chunk.bytes === "string")
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
  scanner.usage = () => events.usage();
  scanner.completed = () => events.completed();
  return scanner;
}
