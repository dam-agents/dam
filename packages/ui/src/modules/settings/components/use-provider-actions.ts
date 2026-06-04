import type { SecretCreateInput, SecretUpdateInput } from "api-server-api";

import { useStore } from "../../../store.js";
import { useAgentsList } from "../../agents/api/queries.js";
import {
  useCreateSecret,
  useDeleteSecret,
  useUpdateSecret,
} from "../../secrets/api/mutations.js";

/**
 * Provider-card actions: confirm-then-delete, create-then-maybe-navigate,
 * and plain update. Hoisted out of the per-provider Cards so each Card is
 * pure glue between its specific Connected/Form components and the
 * mutation layer — no duplicated boilerplate, no re-invented onboarding
 * navigation.
 *
 * The "first agent? go to list" navigation is part of the onboarding
 * flow: creating any provider preset moves the user out of the wizard.
 * Lives here (not in each Card) because it's identical across providers.
 */
export function useProviderActions() {
  const showConfirm = useStore((s) => s.showConfirm);
  const setView = useStore((s) => s.setView);
  const agents = useAgentsList();
  const createSecret = useCreateSecret();
  const updateSecret = useUpdateSecret();
  const deleteSecret = useDeleteSecret();

  return {
    /** Confirm with the user, then delete the secret. No-op on cancel.
     *  Uses the destructive confirm variant — removing a provider breaks
     *  any agent currently using it, so the dialog leans on the
     *  destructive token to telegraph that. */
    async remove(id: string, displayName: string) {
      const ok = await showConfirm(
        `Are you sure you want to remove ${displayName}? Any agent currently using this provider will no longer work as expected.`,
        `Remove ${displayName}?`,
        { kind: "destructive", confirmLabel: "Remove provider" },
      );
      if (!ok) return;
      deleteSecret.mutate({ id });
    },

    /** Create a new secret. If this is the user's first secret of any kind
     *  (no agents yet), navigate to the agent list — they're done with
     *  the providers wizard. */
    async create(input: SecretCreateInput) {
      const isFirst = agents.length === 0;
      await createSecret.mutateAsync(input);
      if (isFirst) setView("list");
    },

    /** Replace value/envMappings on an existing secret. */
    async update(input: SecretUpdateInput) {
      await updateSecret.mutateAsync(input);
    },
  };
}
