import { starterKitScheduleOverrideSchema } from "api-server-api";
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
  customImage: z.string().default(""),
  skipSeed: z.boolean().default(false),
  hibernationTimeoutMin: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .default(null)
    .catch(null),
  slackChannelId: z.string().default(""),
  skippedSchedules: z.array(z.string()).default([]),
  scheduleOverrides: z.array(starterKitScheduleOverrideSchema).default([]),
});
export type SetupForm = z.infer<typeof setupFormSchema>;

export interface SetupFormState {
  form: SetupForm;
  update: (patch: Partial<SetupForm>) => void;
  toggleConnection: (id: string, granted: boolean) => void;
  reset: () => void;
}

function save(key: string, form: SetupForm): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(form));
  } catch {}
}

function load(key: string, flow: SetupFlow): SetupForm | null {
  let stored: unknown;
  try {
    const raw = sessionStorage.getItem(key);
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
  scope?: string,
): SetupFormState {
  const key = scope
    ? `platform-setup-${flow}:${scope}`
    : `platform-setup-${flow}`;
  const [form, setForm] = useState<SetupForm>(() => {
    const restored = load(key, flow);
    if (restored) return restored;
    const fresh = setupFormSchema.parse({ name: "", ...defaults });
    save(key, fresh);
    return fresh;
  });

  const update = useCallback(
    (patch: Partial<SetupForm>) => {
      setForm((prev) => {
        const next = { ...prev, ...patch };
        save(key, next);
        return next;
      });
    },
    [key],
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
        save(key, next);
        return next;
      });
    },
    [key],
  );

  const setName = useCallback((name: string) => update({ name }), [update]);
  usePrefilledSandboxName(flow, form.name, setName);

  const reset = useCallback(() => {
    try {
      sessionStorage.removeItem(key);
    } catch {}
  }, [key]);

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
        save(key, next);
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
  }, [key, returnPath]);

  return { form, update, toggleConnection, reset };
}
