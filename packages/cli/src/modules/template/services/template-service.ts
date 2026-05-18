import { z } from "zod";
import { err, type Result } from "../../../result.js";
import type { AuthRequiredError, TransportError } from "../../shared/errors.js";
import { trpcCall } from "../../shared/trpc/classify.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";

export interface Template {
  id: string;
  name: string;
  image: string;
  description?: string;
}

const TemplateListSchema = z.array(z.object({
  id: z.string(),
  name: z.string(),
  image: z.string(),
  description: z.string().optional(),
}));

export interface TemplateService {
  list(): Promise<Result<readonly Template[], TransportError | AuthRequiredError>>;
}

export function createTemplateService(deps: { trpc: TrpcClient }): TemplateService {
  return {
    async list() {
      const result = await trpcCall(() => deps.trpc.templates.list.query());
      if (!result.ok) return result;
      const parsed = TemplateListSchema.safeParse(result.value);
      if (!parsed.success) return err({ kind: "transport", reason: `unexpected templates response: ${parsed.error.message}` });
      return { ok: true, value: parsed.data } as Result<readonly Template[], never>;
    },
  };
}
