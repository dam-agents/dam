import { avatarSchema, starterKitScheduleOverrideSchema } from "api-server-api";
import { useCallback, useEffect, useState } from "react";
import { match } from "ts-pattern";
import { z } from "zod";

import { emitToast } from "../../../lib/toast.js";
import { usePrefilledSandboxName } from "../../agents/hooks/use-default-sandbox-name.js";
import { fetchConnection } from "../../connections/api/queries.js";

export type SetupFlow = "coding-agent" | "starter-kit";

const setupFormSchema = z.object({
  name: z.string(),
  avatar: avatarSchema.nullable().default(null).catch(null),
  connectionIds: z.array(z.string()).default([]),
  slackChannelIds: z.array(z.string()).default([]),
  skippedSchedules: z.array(z.string()).default([]),
  scheduleOverrides: z.array(starterKitScheduleOverrideSchema).default([]),
});
type SetupForm = z.infer<typeof setupFormSchema>;

interface SetupFormState {
  form: SetupForm;
  update: (patch: Partial<SetupForm>) => void;
  toggleConnection: (id: string, granted: boolean) => void;
  reset: () => void;
  signedInParentId: string | null;
  clearSignedIn: () => void;
}

async function returnedConnectionKind(
  connectionId: string,
): Promise<"sign-in" | "connection" | "unreadable"> {
  try {
    const connection = await fetchConnection(connectionId);
    if (!connection) return "unreadable";
    return connection.isParent ? "sign-in" : "connection";
  } catch {
    return "unreadable";
  }
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
  options: { namePrefix: string; returnPath?: string; scope?: string },
): SetupFormState {
  const { namePrefix, returnPath, scope } = options;
  const key = scope
    ? `platform-setup-${flow}:${scope}`
    : `platform-setup-${flow}`;
  const [form, setForm] = useState<SetupForm>(() => {
    const restored = load(key, flow);
    if (restored) return restored;
    const fresh = setupFormSchema.parse({ name: "" });
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

  const [signedInParentId, setSignedInParentId] = useState<string | null>(null);
  const clearSignedIn = useCallback(() => setSignedInParentId(null), []);

  const setName = useCallback((name: string) => update({ name }), [update]);
  usePrefilledSandboxName(namePrefix, form.name, setName);

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
      void returnedConnectionKind(connectionId).then((kind) =>
        match(kind)
          .with("sign-in", () => setSignedInParentId(connectionId))
          .with("connection", () => toggleConnection(connectionId, true))
          .with("unreadable", () =>
            emitToast({
              kind: "error",
              message:
                "Connection authorized, but it couldn't be read, so it wasn't added. Add it from the connection list.",
            }),
          )
          .exhaustive(),
      );
      return;
    }
    emitToast({
      kind: "error",
      message:
        result === "success"
          ? "Connection authorized, but no connection was returned."
          : `Connection authorization failed: ${params.get("message") ?? "unknown error"}`,
    });
  }, [key, returnPath, toggleConnection]);

  return {
    form,
    update,
    toggleConnection,
    reset,
    signedInParentId,
    clearSignedIn,
  };
}
