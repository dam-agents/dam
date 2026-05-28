import crypto from "node:crypto";
import type * as k8s from "@kubernetes/client-node";
import type { SecretRef } from "api-server-api";
import type { K8sClient } from "../../agents/infrastructure/k8s.js";
import type { SecretMetadata, SecretStore } from "../services/secret-store.js";

const LABEL_OWNER = "agent-platform.ai/owner";
const LABEL_MANAGED_BY = "agent-platform.ai/managed-by";
const LABEL_PURPOSE = "agent-platform.ai/secret-purpose";
const MANAGED_BY_VALUE = "api-server";

const NAME_PREFIX = "platform-secret-";

export interface KubernetesSecretStoreOpts {
  k8s: K8sClient;
  storeId?: string;
}

export function createKubernetesSecretStore(
  opts: KubernetesSecretStoreOpts,
): SecretStore {
  const storeId = opts.storeId ?? "k8s";
  const k8sClient = opts.k8s;

  function ensureOwn(ref: Pick<SecretRef, "storeId">): void {
    if (ref.storeId !== undefined && ref.storeId !== storeId) {
      throw new Error(
        `k8s secret store cannot handle ref with storeId=${JSON.stringify(ref.storeId)}`,
      );
    }
  }

  function encodeBody(
    name: string,
    fields: Record<string, string>,
    meta: SecretMetadata,
  ): k8s.V1Secret {
    const data: Record<string, string> = {};
    for (const [k, v] of Object.entries(fields)) {
      data[k] = Buffer.from(v, "utf8").toString("base64");
    }
    return {
      apiVersion: "v1",
      kind: "Secret",
      metadata: {
        name,
        namespace: k8sClient.namespace,
        labels: {
          [LABEL_MANAGED_BY]: MANAGED_BY_VALUE,
          [LABEL_OWNER]: meta.owner,
          [LABEL_PURPOSE]: sanitizeLabel(meta.purpose),
          ...(meta.extraLabels ?? {}),
        },
        annotations: {
          [LABEL_PURPOSE]: meta.purpose,
          ...(meta.extraAnnotations ?? {}),
        },
      },
      type: "Opaque",
      data,
    };
  }

  return {
    storeId,

    mintRef(meta): SecretRef {
      const nonce = crypto.randomBytes(8).toString("hex");
      const digest = crypto
        .createHash("sha256")
        .update(`${meta.owner}|${meta.purpose}|${nonce}`)
        .digest("hex")
        .slice(0, 12);
      const purposeSlug = sanitizeLabel(meta.purpose).slice(0, 24);
      return {
        storeId,
        path: `${NAME_PREFIX}${purposeSlug}-${digest}`,
        field: "",
      };
    },

    async put(ref, fields, meta): Promise<void> {
      ensureOwn(ref);
      const body = encodeBody(ref.path, fields, meta);
      const existing = await k8sClient.getSecret(ref.path);
      if (existing) {
        await k8sClient.replaceSecret(ref.path, body);
      } else {
        await k8sClient.createSecret(body);
      }
    },

    async putFields(ref, fields): Promise<void> {
      ensureOwn(ref);
      const existing = await k8sClient.getSecret(ref.path);
      if (!existing) {
        throw new Error(
          `putFields: secret ${ref.path} does not exist — call put() first`,
        );
      }
      const data: Record<string, string> = {
        ...((existing.data ?? {}) as Record<string, string>),
      };
      for (const [k, v] of Object.entries(fields)) {
        data[k] = Buffer.from(v, "utf8").toString("base64");
      }
      const body: k8s.V1Secret = { ...existing, data };
      await k8sClient.replaceSecret(ref.path, body);
    },

    async putField(ref, value): Promise<void> {
      ensureOwn(ref);
      const existing = await k8sClient.getSecret(ref.path);
      const data: Record<string, string> = {
        ...((existing?.data ?? {}) as Record<string, string>),
      };
      data[ref.field] = Buffer.from(value, "utf8").toString("base64");
      const body: k8s.V1Secret = {
        ...(existing ?? { apiVersion: "v1", kind: "Secret", type: "Opaque" }),
        metadata: existing?.metadata ?? {
          name: ref.path,
          namespace: k8sClient.namespace,
          labels: { [LABEL_MANAGED_BY]: MANAGED_BY_VALUE },
        },
        data,
      };
      if (existing) {
        await k8sClient.replaceSecret(ref.path, body);
      } else {
        await k8sClient.createSecret(body);
      }
    },

    async get(ref): Promise<Record<string, string> | null> {
      ensureOwn(ref);
      const secret = await k8sClient.getSecret(ref.path);
      if (!secret?.data) return null;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(secret.data)) {
        out[k] = Buffer.from(v as string, "base64").toString("utf8");
      }
      return out;
    },

    async getField(ref): Promise<string | null> {
      ensureOwn(ref);
      const secret = await k8sClient.getSecret(ref.path);
      const raw = secret?.data?.[ref.field];
      if (!raw) return null;
      return Buffer.from(raw as string, "base64").toString("utf8");
    },

    async delete(ref): Promise<void> {
      ensureOwn(ref);
      await k8sClient.deleteSecret(ref.path);
    },

    async list(scope): Promise<{ ref: SecretRef; metadata: SecretMetadata }[]> {
      const selectors = [
        `${LABEL_MANAGED_BY}=${MANAGED_BY_VALUE}`,
        `${LABEL_OWNER}=${scope.owner}`,
      ];
      if (scope.purpose) {
        selectors.push(`${LABEL_PURPOSE}=${sanitizeLabel(scope.purpose)}`);
      }
      const secrets = await k8sClient.listSecrets(selectors.join(","));
      const out: { ref: SecretRef; metadata: SecretMetadata }[] = [];
      for (const s of secrets) {
        const name = s.metadata?.name;
        if (!name) continue;
        const purpose =
          s.metadata?.annotations?.[LABEL_PURPOSE] ??
          s.metadata?.labels?.[LABEL_PURPOSE] ??
          "";
        out.push({
          ref: { storeId, path: name, field: "" },
          metadata: { owner: scope.owner, purpose },
        });
      }
      return out;
    },
  };
}

function sanitizeLabel(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 63);
}
