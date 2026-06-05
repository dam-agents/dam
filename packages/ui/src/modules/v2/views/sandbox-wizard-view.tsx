import { useEffect } from "react";

import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import { useCreateAgent } from "../../agents/api/mutations.js";
import { SandboxShell } from "../components/sandbox-shell.js";
import { GithubStep } from "../components/wizard/github-step.js";
import { LlmStep } from "../components/wizard/llm-step.js";
import { useSandboxWizard } from "../hooks/use-sandbox-wizard.js";
import { loadSnapshot } from "../lib/wizard-snapshot.js";

export function SandboxWizardView() {
  const { snapshot, update, reset } = useSandboxWizard();
  const setView = useStore((s) => s.setView);
  const openSandboxTerminal = useStore((s) => s.openSandboxTerminal);
  const createAgent = useCreateAgent();

  // Resume after a popup-blocked, step-2 OAuth redirect lands back on /v2/new.
  // Match the returned connection to GitHub or GHE so the right card flips.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("oauth");
    if (!result) return;
    const connection = params.get("connection");
    window.history.replaceState({}, "", "/v2/new");
    if (result === "success") {
      const saved = loadSnapshot();
      update(
        connection && connection === saved.gheConnectionId
          ? { step: 2, gheAuthorized: true }
          : { step: 2, githubAuthorized: true },
      );
    } else {
      update({ step: 2 });
      emitToast({
        kind: "error",
        message: `GitHub authorization failed: ${params.get("message") ?? "unknown error"}`,
      });
    }
  }, [update]);

  const cancel = () => {
    reset();
    setView("v2-list");
  };

  const createSandbox = async () => {
    if (!snapshot.llmSecretId || !snapshot.name.trim()) return;
    const appConnectionIds = [
      snapshot.githubAuthorized ? snapshot.githubConnectionId : null,
      snapshot.gheAuthorized ? snapshot.gheConnectionId : null,
    ].filter((id): id is string => Boolean(id));
    const agent = await createAgent.mutateAsync({
      name: snapshot.name.trim(),
      templateId: snapshot.harness,
      egressPreset: "trusted",
      secretIds: [snapshot.llmSecretId],
      ...(appConnectionIds.length ? { appConnectionIds } : {}),
    });
    reset();
    openSandboxTerminal(agent.id);
  };

  return (
    <SandboxShell
      breadcrumbs={[
        { label: "Sandboxes", onClick: cancel },
        { label: "New sandbox" },
      ]}
    >
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[520px] px-4 py-8 md:py-12">
          {snapshot.step === 1 ? (
            <LlmStep
              snapshot={snapshot}
              update={update}
              onCancel={cancel}
              onNext={() => update({ step: 2 })}
            />
          ) : (
            <GithubStep
              snapshot={snapshot}
              update={update}
              onBack={() => update({ step: 1 })}
              onCreate={createSandbox}
              creating={createAgent.isPending}
            />
          )}
        </div>
      </div>
    </SandboxShell>
  );
}
