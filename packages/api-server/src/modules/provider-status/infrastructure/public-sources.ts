import { CURVE_BENDER_HOST, IBM_LITELLM_HOST } from "api-server-api";
import { match } from "ts-pattern";
import { z } from "zod";
import type {
  ProxySource,
  PublicSource,
  SourceReading,
} from "../domain/public-signals.js";

export interface PublicSources {
  read(source: PublicSource): Promise<SourceReading>;
}

const TIMEOUT_MS = 5_000;

const READINESS_URLS: Readonly<Record<ProxySource, string>> = {
  "curve-bender": `https://${CURVE_BENDER_HOST}/health/readiness`,
  "ibm-litellm": `https://${IBM_LITELLM_HOST}/health/readiness`,
};

const STATUSPAGE_URLS = {
  claude: "https://status.claude.com/api/v2/summary.json",
  openai: "https://status.openai.com/api/v2/summary.json",
} as const;

const BOB_STATUS_URL = "https://status.bob.ibm.com/api/v1/status";

const readinessSchema = z.object({ status: z.string() });

const statuspageSchema = z.object({
  components: z.array(z.object({ name: z.string(), status: z.string() })),
});

const bobStatusSchema = z.object({
  regions: z.array(
    z.object({
      services: z.array(
        z.object({
          name: z.string(),
          originalName: z.string().catch(""),
          status: z.string(),
        }),
      ),
    }),
  ),
});

async function getJson(
  url: string,
): Promise<{ status: number; body: unknown } | null> {
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch {
    return null;
  }
}

async function bodyOf<T>(url: string, schema: z.ZodType<T>): Promise<T | null> {
  const res = await getJson(url);
  if (res?.status !== 200) return null;
  const parsed = schema.safeParse(res.body);
  return parsed.success ? parsed.data : null;
}

export function createHttpPublicSources(): PublicSources {
  return {
    read(source) {
      return match(source)
        .with("curve-bender", "ibm-litellm", async (proxy) => ({
          source: proxy,
          healthy:
            (await bodyOf(READINESS_URLS[proxy], readinessSchema))?.status ===
            "healthy",
        }))
        .with("claude", "openai", async (page) => ({
          source: page,
          components:
            (await bodyOf(STATUSPAGE_URLS[page], statuspageSchema))
              ?.components ?? null,
        }))
        .with("bob", async () => ({
          source: "bob" as const,
          services:
            (await bodyOf(BOB_STATUS_URL, bobStatusSchema))?.regions.flatMap(
              (r) => r.services,
            ) ?? null,
        }))
        .exhaustive();
    },
  };
}
