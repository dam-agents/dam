import type { SecretCreateInput } from "api-server-api";

import { Modal } from "../../../components/modal.js";
import {
  bobEnvMappings,
  bobPinsFromEnvMappings,
  ibmLitellmEnvMappings,
  type ProviderPresetType,
  PROVIDERS,
  type SecretView,
} from "../../../types.js";
import {
  useCreateSecret,
  useUpdateSecret,
} from "../../secrets/api/mutations.js";
import { AnthropicForm } from "../../settings/components/anthropic/form.js";
import {
  detectMode,
  MODES,
} from "../../settings/components/anthropic/modes.js";
import { BobForm } from "../../settings/components/bob/form.js";
import { IbmLitellmForm } from "../../settings/components/ibm-litellm/form.js";
import { OpenAIForm } from "../../settings/components/openai/form.js";

interface Props {
  provider: ProviderPresetType;
  secret?: SecretView;
  onConnected: (secretId: string) => void;
  onClose: () => void;
}

// Saves via the secret mutations directly, not useProviderActions, whose
// first-credential setView("list") would eject the user from the wizard.
export function ProviderConnectDialog({
  provider,
  secret,
  onConnected,
  onClose,
}: Props) {
  const createSecret = useCreateSecret();
  const updateSecret = useUpdateSecret();

  const persist = async (input: SecretCreateInput) => {
    if (secret) {
      await updateSecret.mutateAsync({
        id: secret.id,
        value: input.value,
        envMappings: input.envMappings,
      });
      onConnected(secret.id);
    } else {
      const created = await createSecret.mutateAsync(input);
      onConnected(created.id);
    }
  };

  return (
    <Modal widthClass="w-[480px]">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {provider === "anthropic" && (
          <AnthropicForm
            variant={secret ? "edit" : "wizard"}
            initialMode={
              secret ? detectMode(secret.envMappings?.[0]?.envName) : "oauth"
            }
            onCancel={onClose}
            onSave={({ mode, value }) =>
              persist({
                type: "anthropic",
                name: PROVIDERS.anthropic.displayName,
                value,
                envMappings: [MODES[mode].mapping],
              })
            }
          />
        )}
        {provider === "bob" && (
          <BobForm
            variant={secret ? "edit" : "wizard"}
            initialPins={
              secret ? bobPinsFromEnvMappings(secret.envMappings) : undefined
            }
            onCancel={onClose}
            onSave={({ value, pins }) =>
              persist({
                type: "bob",
                name: PROVIDERS.bob.displayName,
                value,
                envMappings: bobEnvMappings(pins),
              })
            }
          />
        )}
        {provider === "openai" && (
          <OpenAIForm
            variant={secret ? "edit" : "wizard"}
            onCancel={onClose}
            onSave={({ value }) =>
              persist({
                type: "openai",
                name: PROVIDERS.openai.displayName,
                value,
              })
            }
          />
        )}
        {provider === "ibm-litellm" && (
          <IbmLitellmForm
            variant={secret ? "edit" : "wizard"}
            onCancel={onClose}
            onSave={({ value }) =>
              persist({
                type: "ibm-litellm",
                name: PROVIDERS["ibm-litellm"].displayName,
                value,
                envMappings: ibmLitellmEnvMappings(),
              })
            }
          />
        )}
      </div>
    </Modal>
  );
}
