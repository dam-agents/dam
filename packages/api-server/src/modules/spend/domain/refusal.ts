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

export const CEILING_TEXT =
  "Spend quota exceeded for today. Ask the platform operator for a higher ceiling.";

export function softLimitText(brandName: string): string {
  const brand = brandName.trim();
  return brand && !/\d/.test(brand)
    ? `Spend quota exceeded for today. The owner can approve more in ${brand}.`
    : "Spend quota exceeded for today. The owner can approve more.";
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
