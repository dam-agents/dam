import type { EgressPreset } from "../../../types.js";
import type { ProviderRef } from "../../providers/components/provider-item.js";
import {
  type RegistryCredential,
  registryFilledCount,
} from "../../sandboxes/components/registry-credential-section.js";
import type { CreateAgentInput } from "../api/mutations.js";

export interface CreateAgentDraft {
  name: string;
  templateId: string | null;
  providerRef: ProviderRef | null;
  egressPreset: EgressPreset;
}

export function isCreateAgentDraftComplete(draft: CreateAgentDraft): boolean {
  return (
    draft.name.trim().length > 0 &&
    draft.templateId !== null &&
    draft.providerRef !== null
  );
}

export function buildCreateAgentInput(
  draft: CreateAgentDraft,
): CreateAgentInput {
  if (!isCreateAgentDraftComplete(draft)) {
    throw new Error("cannot build create-agent input from an incomplete draft");
  }
  return {
    name: draft.name.trim(),
    templateId: draft.templateId!,
    egressPreset: draft.egressPreset,
    appConnectionIds: [draft.providerRef!.id],
  };
}

export interface CodingAgentSetupDraft {
  name: string;
  templateId: string | null;
  customImage: string;
  providerRef: ProviderRef | null;
  connectionIds: string[];
  registryCredential: RegistryCredential;
}

export function setupUsesCustomImage(draft: CodingAgentSetupDraft): boolean {
  return draft.customImage.trim().length > 0;
}

export function hasPartialRegistryCredential(
  draft: CodingAgentSetupDraft,
): boolean {
  if (!setupUsesCustomImage(draft)) return false;
  const filled = registryFilledCount(draft.registryCredential);
  return filled > 0 && filled < 3;
}

export function isCodingAgentSetupComplete(
  draft: CodingAgentSetupDraft,
): boolean {
  return (
    draft.name.trim().length > 0 &&
    draft.providerRef !== null &&
    (draft.templateId !== null || setupUsesCustomImage(draft)) &&
    !hasPartialRegistryCredential(draft)
  );
}

export function buildCodingAgentSetupInput(
  draft: CodingAgentSetupDraft,
): CreateAgentInput {
  if (!isCodingAgentSetupComplete(draft)) {
    throw new Error("cannot build create-agent input from an incomplete draft");
  }
  const image = draft.customImage.trim();
  const credential = draft.registryCredential;
  return {
    name: draft.name.trim(),
    egressPreset: "trusted",
    ...(image ? { image } : { templateId: draft.templateId! }),
    appConnectionIds: [...draft.connectionIds, draft.providerRef!.id],
    ...(image && registryFilledCount(credential) === 3
      ? {
          registryCredential: {
            server: credential.server.trim(),
            username: credential.username.trim(),
            password: credential.password,
          },
        }
      : {}),
  };
}
