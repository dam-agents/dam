import type {
  ConnectionCreateInput,
  ConnectionUpdateInput,
} from "api-server-api";

import { Modal } from "../../../components/modal.js";
import {
  BEDROCK_TEMPLATE_ID,
  type BedrockPins,
  type BobModelPins,
  type ProviderPresetType,
} from "../../../types.js";
import {
  useCreateConnection,
  useUpdateConnection,
} from "../../connections/api/mutations.js";
import { AnthropicForm } from "./anthropic/form.js";
import { type Mode, MODES } from "./anthropic/modes.js";
import { BedrockForm } from "./bedrock/form.js";
import { BobForm } from "./bob/form.js";
import { LiteLlmProxyForm } from "./litellm-proxy/form.js";
import { OpenAIForm } from "./openai/form.js";
import {
  bobConfigInputs,
  bobPinsFromConnection,
  bobUpdateInput,
  type ProviderItem,
  type ProviderRef,
} from "./provider-item.js";

interface Props {
  provider: ProviderPresetType;
  item?: ProviderItem;
  onConnected: (ref: ProviderRef) => void;
  onClose: () => void;
}

export function ProviderConnectDialog({
  provider,
  item,
  onConnected,
  onClose,
}: Props) {
  const createConnection = useCreateConnection();
  const updateConnection = useUpdateConnection();

  const variant = item ? "edit" : "wizard";

  const persist = async (args: {
    value: string;
    createInput: ConnectionCreateInput;
    updateInput?: ConnectionUpdateInput;
  }) => {
    if (item) {
      await updateConnection.mutateAsync(
        args.updateInput ?? { id: item.id, value: args.value },
      );
      onConnected({ id: item.id });
    } else {
      const created = await createConnection.mutateAsync(args.createInput);
      onConnected({ id: created.id });
    }
  };

  const anthropicMode: Mode = item
    ? item.conn.templateId === "anthropic-oauth"
      ? "oauth"
      : "api-key"
    : "oauth";

  const bobPins: BobModelPins | undefined = item
    ? bobPinsFromConnection(item.conn)
    : undefined;

  return (
    <Modal widthClass="w-[505px]">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {provider === "anthropic" && (
          <AnthropicForm
            variant={variant}
            initialMode={anthropicMode}
            lockMode={!!item}
            onCancel={onClose}
            onSave={({ mode, value }) =>
              persist({
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
        )}
        {provider === "bob" && (
          <BobForm
            variant={variant}
            initialPins={bobPins}
            onCancel={onClose}
            onSave={({ value, pins }) =>
              persist({
                value,
                updateInput: item && bobUpdateInput(item.id, value, pins),
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
        )}
        {provider === "openai" && (
          <OpenAIForm
            variant={variant}
            onCancel={onClose}
            onSave={({ value }) =>
              persist({
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
        )}
        {provider === "bedrock" && (
          <BedrockForm
            variant={variant}
            onCancel={onClose}
            onSave={({ value, pins }) =>
              persist({
                value,
                createInput: {
                  templateId: BEDROCK_TEMPLATE_ID,
                  name: BEDROCK_TEMPLATE_ID,
                  authKind: "header",
                  value,
                  configInputs: bedrockConfigInputs(pins),
                },
              })
            }
          />
        )}
        {(provider === "ibm-litellm" || provider === "curve-bender") && (
          <LiteLlmProxyForm
            provider={provider}
            variant={variant}
            onCancel={onClose}
            onSave={({ value }) =>
              persist({
                value,
                createInput: {
                  templateId: provider,
                  name: provider,
                  authKind: "header",
                  value,
                },
              })
            }
          />
        )}
      </div>
    </Modal>
  );
}

function bedrockConfigInputs(pins: BedrockPins): Record<string, string> {
  return pins.model
    ? { region: pins.region, model: pins.model }
    : { region: pins.region };
}
