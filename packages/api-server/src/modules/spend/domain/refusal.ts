import { PLATFORM_REFUSAL_HEADER } from "api-server-api";
import { match } from "ts-pattern";
import type { ApiDialect } from "./call.js";

export interface Refusal {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

const MIN_RETRY_AFTER_SECONDS = 61;
const DAY_MS = 24 * 60 * 60 * 1000;

export function nextUtcMidnight(now: Date): Date {
  return new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS + DAY_MS);
}

export function softLimitText(brandName: string): string {
  const brand = brandName.trim();
  return brand && !/\d/.test(brand)
    ? `Spend quota exceeded for today. The owner can approve more in ${brand}.`
    : "Spend quota exceeded for today. The owner can approve more.";
}

export function refusalFor(
  dialect: ApiDialect,
  text: string,
  now: Date,
): Refusal {
  const plain = {
    "content-type": "text/plain",
    [PLATFORM_REFUSAL_HEADER]: "spend",
  };
  return match(dialect)
    .with(
      "anthropic-messages",
      "bedrock-invoke",
      "bedrock-converse",
      (): Refusal => ({
        status: 429,
        headers: {
          ...plain,
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
        body: text,
      }),
    )
    .with(
      "openai-chat",
      "openai-responses",
      "openai-embeddings",
      (): Refusal => ({ status: 400, headers: plain, body: text }),
    )
    .exhaustive();
}
