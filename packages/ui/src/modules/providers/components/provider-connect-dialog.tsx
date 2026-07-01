import type { ConnectionCreateInput } from "api-server-api";

import { Modal } from "../../../components/modal.js";
import type { BobModelPins, ProviderPresetType } from "../../../types.js";
import {
  useCreateConnection,
  useUpdateConnection,
} from "../../connections/api/mutations.js";
import { AnthropicForm } from "./anthropic/form.js";
import { type Mode, MODES } from "./anthropic/modes.js";
import { BobForm } from "./bob/form.js";
import { IbmLitellmForm } from "./ibm-litellm/form.js";
import { OpenAIForm } from "./openai/form.js";
import {
  bobPinsFromConnection,
  type ProviderItem,
  type ProviderRef,
} from "./provider-item.js";

interface Props {
  provider: ProviderPresetType;
  item?: ProviderItem;
  onConnected: (ref: ProviderRef) => void;
  onClose: () => void;
}

// New setup writes a Connection. Editing rotates the value in place —
// connections.update is value-only, so config-input changes on an existing
// connection don't persist.
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
  }) => {
    if (item) {
      await updateConnection.mutateAsync({ id: item.id, value: args.value });
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
        {provider === "ibm-litellm" && (
          <IbmLitellmForm
            variant={variant}
            onCancel={onClose}
            onSave={({ value }) =>
              persist({
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
        )}
      </div>
    </Modal>
  );
}

function bobConfigInputs(pins: BobModelPins): Record<string, string> {
  const out: Record<string, string> = {};
  if (pins.model) out.model = pins.model;
  if (pins.agentId) out.instanceId = pins.agentId;
  if (pins.teamId) out.teamId = pins.teamId;
  if (pins.maxCoins) out.maxCoins = pins.maxCoins;
  if (pins.chatMode) out.chatMode = pins.chatMode;
  return out;
}
