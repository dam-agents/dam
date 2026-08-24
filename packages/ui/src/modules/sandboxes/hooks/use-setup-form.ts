import { knowledgeBaseTemplateIdSchema } from "api-server-api";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

import { emitToast } from "../../../lib/toast.js";
import { usePrefilledSandboxName } from "../../agents/hooks/use-default-sandbox-name.js";
import type { SandboxNameKind } from "../../agents/lib/sandbox-name.js";

export type SetupFlow = SandboxNameKind;

export const setupFormSchema = z.object({
  name: z.string(),
  providerRef: z.object({ id: z.string() }).nullable().default(null),
  connectionIds: z.array(z.string()).default([]),
  templateId: z.string().nullable().default(null),
  kbTemplateId: knowledgeBaseTemplateIdSchema.nullable().default(null),
  customImage: z.string().default(""),
});
export type SetupForm = z.infer<typeof setupFormSchema>;

export interface SetupFormState {
  form: SetupForm;
  update: (patch: Partial<SetupForm>) => void;
  toggleConnection: (id: string, granted: boolean) => void;
  reset: () => void;
}

function storageKey(flow: SetupFlow): string {
  return `platform-setup-${flow}`;
}

function save(flow: SetupFlow, form: SetupForm): void {
  try {
    sessionStorage.setItem(storageKey(flow), JSON.stringify(form));
  } catch {}
}

function load(flow: SetupFlow): SetupForm | null {
  let stored: unknown;
  try {
    const raw = sessionStorage.getItem(storageKey(flow));
    if (!raw) return null;
    stored = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = setupFormSchema.safeParse(stored);
  if (!parsed.success) {
    console.warn(
      `[setup-form] discarding unusable ${flow} draft:`,
      parsed.error.issues,
    );
    return null;
  }
  return parsed.data;
}

export function useSetupForm(
  flow: SetupFlow,
  defaults: Partial<SetupForm> = {},
  returnPath?: string,
): SetupFormState {
  const [form, setForm] = useState<SetupForm>(() => {
    const restored = load(flow);
    if (restored) return restored;
    const fresh = setupFormSchema.parse({ name: "", ...defaults });
    save(flow, fresh);
    return fresh;
  });

  const update = useCallback(
    (patch: Partial<SetupForm>) => {
      setForm((prev) => {
        const next = { ...prev, ...patch };
        save(flow, next);
        return next;
      });
    },
    [flow],
  );

  const toggleConnection = useCallback(
    (id: string, granted: boolean) => {
      setForm((prev) => {
        const next = {
          ...prev,
          connectionIds: granted
            ? [...new Set([...prev.connectionIds, id])]
            : prev.connectionIds.filter((x) => x !== id),
        };
        save(flow, next);
        return next;
      });
    },
    [flow],
  );

  const setName = useCallback((name: string) => update({ name }), [update]);
  usePrefilledSandboxName(flow, form.name, setName);

  const reset = useCallback(() => {
    try {
      sessionStorage.removeItem(storageKey(flow));
    } catch {}
  }, [flow]);

  useEffect(() => {
    if (!returnPath) return;
    const params = new URLSearchParams(window.location.search);
    const result = params.get("oauth");
    if (!result) return;
    window.history.replaceState({}, "", returnPath);
    const connectionId = params.get("connection");
    if (result === "success" && connectionId) {
      setForm((prev) => {
        const next = {
          ...prev,
          connectionIds: [...new Set([...prev.connectionIds, connectionId])],
        };
        save(flow, next);
        return next;
      });
      return;
    }
    emitToast({
      kind: "error",
      message:
        result === "success"
          ? "Connection authorized, but no connection was returned."
          : `Connection authorization failed: ${params.get("message") ?? "unknown error"}`,
    });
  }, [flow, returnPath]);

  return { form, update, toggleConnection, reset };
}
