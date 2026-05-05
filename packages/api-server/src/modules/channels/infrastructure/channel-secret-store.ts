import { ChannelType } from "api-server-api";
import type { K8sClient } from "../../agents/infrastructure/k8s.js";
import {
  LABEL_TYPE, LABEL_INSTANCE_REF, LABEL_CHANNEL_TYPE,
  TYPE_CHANNEL_SECRET,
} from "../../agents/infrastructure/labels.js";

const TELEGRAM_TOKEN_KEY = "botToken";

export interface ChannelSecretStore {
  storeTelegramToken(instanceId: string, token: string): Promise<void>;
  readTelegramToken(instanceId: string): Promise<string | null>;
  deleteChannelSecret(instanceId: string, type: ChannelType): Promise<void>;
  deleteAllForInstance(instanceId: string): Promise<void>;
}

export function channelSecretName(instanceId: string, type: ChannelType): string {
  return `platform-channel-${type}-${instanceId}`;
}

export function createChannelSecretStore(k8s: K8sClient): ChannelSecretStore {
  return {
    async storeTelegramToken(instanceId, token) {
      const name = channelSecretName(instanceId, ChannelType.Telegram);
      const body = {
        metadata: {
          name,
          labels: {
            [LABEL_TYPE]: TYPE_CHANNEL_SECRET,
            [LABEL_INSTANCE_REF]: instanceId,
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

    async readTelegramToken(instanceId) {
      const name = channelSecretName(instanceId, ChannelType.Telegram);
      const secret = await k8s.getSecret(name);
      if (!secret) return null;
      const encoded = secret.data?.[TELEGRAM_TOKEN_KEY];
      if (!encoded) return null;
      return Buffer.from(encoded, "base64").toString("utf-8");
    },

    async deleteChannelSecret(instanceId, type) {
      await k8s.deleteSecret(channelSecretName(instanceId, type));
    },

    async deleteAllForInstance(instanceId) {
      const selector = `${LABEL_TYPE}=${TYPE_CHANNEL_SECRET},${LABEL_INSTANCE_REF}=${instanceId}`;
      const secrets = await k8s.listSecrets(selector);
      await Promise.all(secrets.map((s) => k8s.deleteSecret(s.metadata!.name!)));
    },
  };
}
