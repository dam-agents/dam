import { ArrowRight } from "@carbon/icons-react";
import type { ConnectionCreateInput } from "api-server-api";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Select } from "@/components/ui/select";

import { getBrand } from "../../../brand.js";
import { Modal } from "../../../components/modal.js";
import { emitToast } from "../../../lib/toast.js";
import { queryClient } from "../../../query-client.js";
import { useStore } from "../../../store.js";
import { PROVIDERS, type ProviderPresetType } from "../../../types.js";
import {
  useCreateConnection,
  useUpdateConnection,
} from "../../connections/api/mutations.js";
import { AnthropicForm } from "../../providers/components/anthropic/form.js";
import { MODES } from "../../providers/components/anthropic/modes.js";
import { BobForm } from "../../providers/components/bob/form.js";
import { IbmLitellmForm } from "../../providers/components/ibm-litellm/form.js";
import { OpenAIForm } from "../../providers/components/openai/form.js";
import type { ProviderRef } from "../../providers/components/provider-item.js";
import { useProviderItems } from "../../providers/hooks/use-provider-items.js";
import { PROVIDER_ROWS } from "../../providers/lib/provider-rows.js";
import { useTemplates } from "../../templates/api/queries.js";
import {
  type CreateAgentInput,
  useCreateAgent,
} from "../api/mutations.js";
import { agentsKeys } from "../api/queries.js";
import { AGENT_NAME_PREFIX } from "../lib/sandbox-name.js";
import type { BobModelPins } from "../../../types.js";

type Step = "welcome" | "provider" | "creating";

export function QuickSetupFlow() {
  const [step, setStep] = useState<Step>("welcome");
  const selectAgent = useStore((s) => s.selectAgent);
  const createAgent = useCreateAgent();
  const { data: templates = [] } = useTemplates();

  const launchAgent = async (ref: ProviderRef) => {
    setStep("creating");

    const templateId =
      (templates.find((t) => !t.experimental) ?? templates[0])?.id ?? null;

    const input: CreateAgentInput = {
      name: `${AGENT_NAME_PREFIX}${Date.now().toString(36)}`,
      ...(templateId ? { templateId } : {}),
      appConnectionIds: [ref.id],
    };

    try {
      const agent = await createAgent.mutateAsync(input);
      void queryClient.invalidateQueries({
        queryKey: agentsKeys.listWithChannels(),
      });
      selectAgent(agent.id);
    } catch {
      emitToast({ kind: "error", message: "Failed to create agent" });
      setStep("provider");
    }
  };

  const brand = getBrand();

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 pb-20 md:px-[5%] md:py-10 md:pb-10">
      <div className="anim-in">
        <Callout tone="muted" className="flex flex-col gap-4 py-8">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Welcome to {brand.name}
          </h1>
          <p className="max-w-[480px] text-[14px] text-foreground/80">
            {brand.name} runs agents in the cloud. Each one gets its own
            isolated environment, with your credentials and tools already set
            up.
          </p>
          <Button
            className="w-fit"
            onClick={() => setStep("provider")}
            data-testid="quick-setup-start"
          >
            <span className="flex items-center gap-2">
              Get started
              <ArrowRight size={16} />
            </span>
          </Button>
        </Callout>
      </div>

      {step === "provider" && (
        <ConnectProviderModal
          onConnected={(ref) => void launchAgent(ref)}
          onClose={() => setStep("welcome")}
        />
      )}

      {step === "creating" && <CreatingOverlay />}
    </div>
  );
}

function ConnectProviderModal({
  onConnected,
  onClose,
}: {
  onConnected: (ref: ProviderRef) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<ProviderPresetType | "">("");
  const { itemByType } = useProviderItems();
  const createConnection = useCreateConnection();
  const updateConnection = useUpdateConnection();

  const handlePick = (type: ProviderPresetType) => {
    const existing = itemByType.get(type);
    if (existing) {
      onConnected({ id: existing.id });
      return;
    }
    setSelected(type);
  };

  const persist = async (args: {
    value: string;
    createInput: ConnectionCreateInput;
  }) => {
    const created = await createConnection.mutateAsync(args.createInput);
    onConnected({ id: created.id });
  };

  return (
    <Modal widthClass="w-[505px]" onClose={onClose}>
      <div className="flex flex-col gap-5 px-6 py-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Connect a provider
          </h2>
          <p className="text-[14px] text-muted-foreground">
            Pick the provider your agent will use.
          </p>
        </div>

        <Select
          value={selected}
          onChange={(e) =>
            handlePick(e.target.value as ProviderPresetType)
          }
          data-testid="provider-picker"
        >
          <option value="" disabled>
            Select a provider
          </option>
          {PROVIDER_ROWS.map((row) => (
            <option key={row.type} value={row.type}>
              {PROVIDERS[row.type].displayName}
              {itemByType.has(row.type) ? " — Connected" : ""}
            </option>
          ))}
        </Select>

        {selected && !itemByType.has(selected) && (
          <div className="anim-in">
            <ProviderCredentialForm
              provider={selected}
              onSave={persist}
              onCancel={onClose}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}

function ProviderCredentialForm({
  provider,
  onSave,
  onCancel,
}: {
  provider: ProviderPresetType;
  onSave: (args: {
    value: string;
    createInput: ConnectionCreateInput;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  if (provider === "anthropic") {
    return (
      <AnthropicForm
        variant="wizard"
        initialMode="oauth"
        lockMode={false}
        onCancel={onCancel}
        onSave={({ mode, value }) =>
          onSave({
            value,
            createInput: {
              templateId: MODES[mode].templateId,
              name: MODES[mode].templateId,
              authKind: "header",
              value,
            },
          })
        }
      />
    );
  }

  if (provider === "bob") {
    return (
      <BobForm
        variant="wizard"
        onCancel={onCancel}
        onSave={({ value, pins }) =>
          onSave({
            value,
            createInput: {
              templateId: "bob",
              name: "bob",
              authKind: "header",
              value,
              configInputs: bobConfigInputs(pins),
            },
          })
        }
      />
    );
  }

  if (provider === "openai") {
    return (
      <OpenAIForm
        variant="wizard"
        onCancel={onCancel}
        onSave={({ value }) =>
          onSave({
            value,
            createInput: {
              templateId: "openai",
              name: "openai",
              authKind: "header",
              value,
            },
          })
        }
      />
    );
  }

  if (provider === "ibm-litellm") {
    return (
      <IbmLitellmForm
        variant="wizard"
        onCancel={onCancel}
        onSave={({ value }) =>
          onSave({
            value,
            createInput: {
              templateId: "ibm-litellm",
              name: "ibm-litellm",
              authKind: "header",
              value,
            },
          })
        }
      />
    );
  }

  return null;
}

function bobConfigInputs(pins: BobModelPins): Record<string, string> {
  const out: Record<string, string> = {};
  if (pins.model) out.model = pins.model;
  if (pins.agentId) out.instanceId = pins.agentId;
  if (pins.teamId) out.teamId = pins.teamId;
  if (pins.maxCost) out.maxCost = pins.maxCost;
  if (pins.chatMode) out.chatMode = pins.chatMode;
  return out;
}

function CreatingOverlay() {
  return (
    <Modal widthClass="w-[420px]">
      <div className="flex flex-col items-center gap-4 py-10 px-6 text-center">
        <div className="size-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
        <p className="text-[14px] font-medium text-foreground">
          Setting up your agent...
        </p>
        <p className="text-[14px] text-muted-foreground">
          This will only take a moment.
        </p>
      </div>
    </Modal>
  );
}
