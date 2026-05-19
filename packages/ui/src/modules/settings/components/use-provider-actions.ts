import type { CreateSecretInput, UpdateSecretInput } from "api-server-api";

import { useStore } from "../../../store.js";
import {
  useCreateSecret,
  useDeleteSecret,
  useUpdateSecret,
} from "../../secrets/api/mutations.js";

/**
 * Provider-card actions: confirm-then-delete, create, and plain update.
 * Hoisted out of the per-provider Cards so each Card is pure glue between
 * its specific Connected/Form components and the mutation layer — no
 * duplicated boilerplate.
 */
export function useProviderActions() {
  const showConfirm = useStore((s) => s.showConfirm);
  const createSecret = useCreateSecret();
  const updateSecret = useUpdateSecret();
  const deleteSecret = useDeleteSecret();

  return {
    /** Confirm with the user, then delete the secret. No-op on cancel. */
    async remove(id: string, confirmMessage: string, confirmButton: string) {
      if (!(await showConfirm(confirmMessage, confirmButton))) return;
      deleteSecret.mutate({ id });
    },

    /** Create a new secret. The view stays put — the providers list
     *  refetches on success and the relevant card flips to its connected
     *  state in place. */
    async create(input: CreateSecretInput) {
      await createSecret.mutateAsync(input);
    },

    /** Replace value/envMappings on an existing secret. */
    async update(input: UpdateSecretInput) {
      await updateSecret.mutateAsync(input);
    },
  };
}
