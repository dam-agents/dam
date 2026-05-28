import { ChannelType } from "api-server-api";
import type { K8sClient } from "../../agents/infrastructure/k8s.js";
import {
  LABEL_TYPE,
  LABEL_AGENT_REF,
  LABEL_CHANNEL_TYPE,
  TYPE_CHANNEL_SECRET,
} from "../../agents/infrastructure/labels.js";

const TELEGRAM_TOKEN_KEY = "botToken";

export interface ChannelSecretStore {
  storeTelegramToken(agentId: string, token: string): Promise<void>;
  readTelegramToken(agentId: string): Promise<string | null>;
  deleteChannelSecret(agentId: string, type: ChannelType): Promise<void>;
  deleteAllForAgent(agentId: string): Promise<void>;
}

export function channelSecretName(agentId: string, type: ChannelType): string {
  return `platform-channel-${type}-${agentId}`;
}

export function createChannelSecretStore(k8s: K8sClient): ChannelSecretStore {
  return {
    async storeTelegramToken(agentId, token) {
      const name = channelSecretName(agentId, ChannelType.Telegram);
      const body = {
        metadata: {
          name,
          labels: {
            [LABEL_TYPE]: TYPE_CHANNEL_SECRET,
            [LABEL_AGENT_REF]: agentId,
            [LABEL_CHANNEL_TYPE]: ChannelType.Telegram,
          },
        },
        type: "Opaque",
        stringData: { [TELEGRAM_TOKEN_KEY]: token },
      };
      const existing = await k8s.getSecret(name);
      if (existing) await k8s.replaceSecret(name, body);
      else await k8s.createSecret(body);
    },

    async readTelegramToken(agentId) {
      const name = channelSecretName(agentId, ChannelType.Telegram);
      const secret = await k8s.getSecret(name);
      if (!secret) return null;
      const encoded = secret.data?.[TELEGRAM_TOKEN_KEY];
      if (!encoded) return null;
      return Buffer.from(encoded, "base64").toString("utf-8");
    },

    async deleteChannelSecret(agentId, type) {
      await k8s.deleteSecret(channelSecretName(agentId, type));
    },

    async deleteAllForAgent(agentId) {
      const selector = `${LABEL_TYPE}=${TYPE_CHANNEL_SECRET},${LABEL_AGENT_REF}=${agentId}`;
      const secrets = await k8s.listSecrets(selector);
      await Promise.all(
        secrets.map((s) => k8s.deleteSecret(s.metadata!.name!)),
      );
    },
  };
}
