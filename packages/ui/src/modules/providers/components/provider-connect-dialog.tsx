import type { ConnectionCreateInput } from "api-server-api";

import { Modal } from "../../../components/modal.js";
import {
  bobEnvMappings,
  type BobModelPins,
  bobPinsFromEnvMappings,
  type EnvMapping,
  ibmLitellmEnvMappings,
  type ProviderPresetType,
} from "../../../types.js";
import {
  useCreateConnection,
  useUpdateConnection,
} from "../../connections/api/mutations.js";
import { useUpdateSecret } from "../../secrets/api/mutations.js";
import { AnthropicForm } from "./anthropic/form.js";
import { detectMode, type Mode, MODES } from "./anthropic/modes.js";
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
// connection don't persist; legacy secrets still take a full value+env update.
export function ProviderConnectDialog({
  provider,
  item,
  onConnected,
  onClose,
}: Props) {
  const createConnection = useCreateConnection();
  const updateConnection = useUpdateConnection();
  const updateSecret = useUpdateSecret();

  const variant = item ? "edit" : "wizard";

  const persist = async (args: {
    value: string;
    createInput: ConnectionCreateInput;
    secretEnvMappings?: EnvMapping[];
  }) => {
    if (item?.source === "connection") {
      await updateConnection.mutateAsync({ id: item.id, value: args.value });
      onConnected({ source: "connection", id: item.id });
    } else if (item?.source === "secret") {
      await updateSecret.mutateAsync({
        id: item.id,
        value: args.value,
        envMappings: args.secretEnvMappings,
      });
      onConnected({ source: "secret", id: item.id });
    } else {
      const created = await createConnection.mutateAsync(args.createInput);
      onConnected({ source: "connection", id: created.id });
    }
  };

  const anthropicMode: Mode =
    item?.source === "connection"
      ? item.conn.templateId === "anthropic-oauth"
        ? "oauth"
        : "api-key"
      : item?.source === "secret"
        ? detectMode(item.secret.envMappings?.[0]?.envName)
        : "oauth";

  const bobPins: BobModelPins | undefined =
    item?.source === "connection"
      ? bobPinsFromConnection(item.conn)
      : item?.source === "secret"
        ? bobPinsFromEnvMappings(item.secret.envMappings)
        : undefined;

  return (
    <Modal widthClass="w-[505px]">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {provider === "anthropic" && (
          <AnthropicForm
            variant={variant}
            initialMode={anthropicMode}
            lockMode={item?.source === "connection"}
            onCancel={onClose}
            onSave={({ mode, value }) =>
              persist({
                value,
                createInput: {
                  templateId:
                    mode === "oauth" ? "anthropic-oauth" : "anthropic",
                  name: mode === "oauth" ? "anthropic-oauth" : "anthropic",
                  authKind: "header",
                  value,
                },
                secretEnvMappings: [MODES[mode].mapping],
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
                secretEnvMappings: bobEnvMappings(pins),
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
                secretEnvMappings: ibmLitellmEnvMappings(),
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
