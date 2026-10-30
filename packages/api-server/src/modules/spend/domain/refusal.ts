import { nextUtcMidnight, PLATFORM_REFUSAL_HEADER } from "api-server-api";
import { match } from "ts-pattern";
import type { ApiDialect } from "./call.js";
import type { SpendBlock } from "./limits.js";

export interface Refusal {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

const MIN_RETRY_AFTER_SECONDS = 61;

export const CEILING_TEXT =
  "Spend quota exceeded for today. Ask the platform operator for a higher ceiling.";

export function softLimitText(brandName: string): string {
  const brand = brandName.trim();
  return brand && !/\d/.test(brand)
    ? `Spend quota exceeded for today. The owner can approve more in ${brand}.`
    : "Spend quota exceeded for today. The owner can approve more.";
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: which spend stop a harness's error text reports.
 * A refusal reaches a channel turn only as the harness's own error, which
 * keeps the refusal body, so the body's fixed opening tells a spend stop from
 * any other failure, and the ceiling's text names the platform operator.
 */
export function spendRefusalIn(text: string): SpendBlock | null {
  if (!/spend quota exceeded/i.test(text)) return null;
  return /platform operator/i.test(text) ? "ceiling" : "limit";
}

const JSON_ERROR_PROVIDERS: ReadonlySet<string> = new Set(["bob"]);

function refusalBody(
  provider: string,
  text: string,
): { contentType: string; body: string } {
  return JSON_ERROR_PROVIDERS.has(provider)
    ? {
        contentType: "application/json",
        body: JSON.stringify({ error: { message: text } }),
      }
    : { contentType: "text/plain", body: text };
}

export function refusalFor(
  call: { readonly dialect: ApiDialect; readonly provider: string },
  text: string,
  now: Date,
): Refusal {
  const { contentType, body } = refusalBody(call.provider, text);
  const content = {
    "content-type": contentType,
    [PLATFORM_REFUSAL_HEADER]: "spend",
  };
  return match(call.dialect)
    .with(
      "anthropic-messages",
      "bedrock-invoke",
      "bedrock-converse",
      (): Refusal => ({
        status: 429,
        headers: {
          ...content,
          "x-should-retry": "false",
          "retry-after": String(
            Math.max(
              MIN_RETRY_AFTER_SECONDS,
              Math.ceil(
                (nextUtcMidnight(now).getTime() - now.getTime()) / 1000,
              ),
            ),
          ),
        },
        body,
      }),
    )
    .with(
      "openai-chat",
      "openai-responses",
      "openai-embeddings",
      (): Refusal => ({ status: 400, headers: content, body }),
    )
    .exhaustive();
}
