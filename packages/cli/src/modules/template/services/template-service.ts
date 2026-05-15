import { z } from "zod";
import { err, ok, type Result } from "../../../result.js";
import type { AuthRequiredError, TransportError } from "../../instance/domain/errors.js";
import { classifyTrpcError } from "../../shared/trpc/classify.js";
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
      try {
        const parsed = TemplateListSchema.safeParse(await deps.trpc.templates.list.query());
        if (!parsed.success) return err({ kind: "transport", reason: `unexpected templates response: ${parsed.error.message}` });
        return ok(parsed.data);
      } catch (e) {
        return classifyTrpcError(e);
      }
    },
  };
}
