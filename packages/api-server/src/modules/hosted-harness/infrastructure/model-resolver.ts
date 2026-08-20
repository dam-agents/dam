import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { Connection } from "api-server-api";

export interface HostedModelConfig {
  baseUrl: string;
  modelId: string;
  fallbackApiKey?: string;
}

export interface ResolvedModel {
  model: LanguageModel;
  modelId: string;
}

export interface ModelResolverDeps {
  config: HostedModelConfig;
  listConnectionsForAgent(agentId: string): Promise<Connection[]>;
  readSecretField(ref: {
    storeId?: string;
    path: string;
    field: string;
  }): Promise<string | null>;
}

export function createModelResolver(deps: ModelResolverDeps) {
  return async function resolveModel(
    agentId: string,
    modelIdOverride?: string,
  ): Promise<ResolvedModel> {
    const host = new URL(deps.config.baseUrl).host;
    let apiKey = deps.config.fallbackApiKey;

    const connections = await deps.listConnectionsForAgent(agentId);
    for (const conn of connections) {
      if (conn.auth?.kind !== "header") continue;
      const injects = conn.contributions.filter(
        (c) => c.kind === "egress-inject",
      );
      if (!injects.some((c) => "host" in c && c.host === host)) continue;
      const value = await deps.readSecretField(conn.auth.valueRef);
      if (value) {
        apiKey = value;
        break;
      }
    }

    if (!apiKey) {
      throw new Error(
        `no LLM credential for agent ${agentId}: grant a connection injecting into ${host}, or set the install fallback key`,
      );
    }

    const provider = createOpenAICompatible({
      name: "hosted-llm",
      baseURL: deps.config.baseUrl,
      apiKey,
    });
    const modelId = modelIdOverride ?? deps.config.modelId;
    return { model: provider.chatModel(modelId), modelId };
  };
}

export type ModelResolver = ReturnType<typeof createModelResolver>;
